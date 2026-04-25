import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import util from 'node:util';
import { saveRuntimeShutdownReport } from '../services/runtimeLogStore.js';

let initialized = false;
let runLogPath = null;
let logDirPath = null;
let logFd = null;

let originalConsole = null;
let originalProcessExit = null;

let maxBufferLines = 8000;
let buffer = [];

let currentActivity = null; // { text, at }
let activityHistory = []; // [{ text, at }]
let lastFatal = null; // { type, value, at }
let shutdownMeta = null; // { reason, signal }

let shutdownReportWritten = false;
let shutdownReportUploaded = false;

const pad2 = (n) => String(n).padStart(2, '0');
const pad3 = (n) => String(n).padStart(3, '0');

const formatTimestamp = (date = new Date()) => {
    const y = date.getFullYear();
    const m = pad2(date.getMonth() + 1);
    const d = pad2(date.getDate());
    const hh = pad2(date.getHours());
    const mm = pad2(date.getMinutes());
    const ss = pad2(date.getSeconds());
    const ms = pad3(date.getMilliseconds());
    return `${y}-${m}-${d} ${hh}:${mm}:${ss}.${ms}`;
};

const formatFileTimestamp = (date = new Date()) => {
    const y = date.getFullYear();
    const m = pad2(date.getMonth() + 1);
    const d = pad2(date.getDate());
    const hh = pad2(date.getHours());
    const mm = pad2(date.getMinutes());
    const ss = pad2(date.getSeconds());
    return `${y}${m}${d}-${hh}${mm}${ss}`;
};

const safeInspect = (value) => {
    if (value instanceof Error) {
        return value.stack || `${value.name}: ${value.message}`;
    }
    if (typeof value === 'string') return value;
    return util.inspect(value, { colors: false, depth: 6, maxArrayLength: 50, breakLength: 120 });
};

const ensureDirSync = (dirPath) => {
    try {
        fs.mkdirSync(dirPath, { recursive: true });
    } catch {
        // ignore
    }
};

const pushBufferLine = (line) => {
    buffer.push(line);
    if (buffer.length > maxBufferLines) {
        buffer.splice(0, buffer.length - maxBufferLines);
    }
};

const writeRunLineSync = (line) => {
    if (!initialized || !logFd) return;
    try {
        fs.writeSync(logFd, line);
    } catch {
        // ignore
    }
};

const buildLogLine = (level, args) => {
    const ts = formatTimestamp();
    const message = args.map(safeInspect).join(' ');
    return `[${ts}] [${level}] ${message}\n`;
};

const setActivityInternal = (text) => {
    const entry = { text: String(text || ''), at: formatTimestamp() };
    currentActivity = entry;
    activityHistory.push(entry);
    if (activityHistory.length > 50) {
        activityHistory.splice(0, activityHistory.length - 50);
    }
};

export const setCurrentActivity = (text) => {
    setActivityInternal(text);
};

export const clearCurrentActivity = () => {
    currentActivity = null;
};

export const recordFatal = (type, value) => {
    lastFatal = { type: String(type || 'fatal'), value, at: formatTimestamp() };
};

export const setShutdownMeta = (meta) => {
    shutdownMeta = meta && typeof meta === 'object' ? { ...meta } : null;
};

const snapshotForReport = () => {
    const tail = buffer.slice(-400);
    return {
        at: formatTimestamp(),
        pid: process.pid,
        node: process.version,
        platform: `${process.platform} ${process.arch}`,
        hostname: os.hostname(),
        cwd: process.cwd(),
        runLogPath,
        currentActivity,
        activityHistory: activityHistory.slice(-20),
        lastFatal,
        shutdownMeta,
        tail,
    };
};

const readFileTailSync = (filePath, maxBytes) => {
    if (!filePath) return null;
    const limit = Math.max(0, Number(maxBytes) || 0);
    if (limit <= 0) return null;

    try {
        const stats = fs.statSync(filePath);
        const size = Number(stats.size || 0);
        if (!Number.isFinite(size) || size <= 0) return null;

        const start = Math.max(0, size - limit);
        const length = size - start;
        if (length <= 0) return null;

        const fd = fs.openSync(filePath, 'r');
        try {
            const buf = Buffer.alloc(length);
            fs.readSync(fd, buf, 0, length, start);
            return buf.toString('utf8');
        } finally {
            try {
                fs.closeSync(fd);
            } catch {
                // ignore
            }
        }
    } catch {
        return null;
    }
};

const serializeSnapshotForMongo = (snap, exitCode) => {
    const safeTail = Array.isArray(snap.tail) ? snap.tail.map((l) => String(l || '').replace(/\n$/, '')) : [];

    const fatalText = snap.lastFatal
        ? String(safeInspect(snap.lastFatal.value)).slice(0, 20000)
        : null;

    const runLogTailText = readFileTailSync(snap.runLogPath, 200_000);

    return {
        kind: 'shutdown_report',
        createdAt: new Date(),
        exitCode: typeof exitCode === 'number' ? exitCode : Number(exitCode) || 0,
        at: snap.at,
        pid: snap.pid,
        node: snap.node,
        platform: snap.platform,
        hostname: snap.hostname,
        cwd: snap.cwd,
        runLogPath: snap.runLogPath,
        runLogTailText,
        shutdownMeta: snap.shutdownMeta || null,
        currentActivity: snap.currentActivity || null,
        activityHistory: snap.activityHistory || [],
        lastFatal: snap.lastFatal
            ? { type: snap.lastFatal.type, at: snap.lastFatal.at, text: fatalText }
            : null,
        tail: safeTail,
    };
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const uploadShutdownReportToMongo = async (exitCode, options = {}) => {
    if (shutdownReportUploaded) return null;
    shutdownReportUploaded = true;

    const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 4500;
    const snap = snapshotForReport();
    const doc = serializeSnapshotForMongo(snap, exitCode);

    try {
        const result = await Promise.race([
            saveRuntimeShutdownReport(doc),
            sleep(timeoutMs).then(() => null),
        ]);

        if (result?.insertedId) {
            writeRunLineSync(buildLogLine('MONGO', [`shutdownReport insertedId=${String(result.insertedId)}`]));
        } else {
            writeRunLineSync(buildLogLine('MONGO', ['shutdownReport upload skipped/timeout']));
        }

        return result;
    } catch (error) {
        writeRunLineSync(buildLogLine('MONGO', ['shutdownReport upload failed', safeInspect(error)]));
        return null;
    }
};

const writeShutdownReportSync = (code) => {
    if (!initialized || shutdownReportWritten) return;
    shutdownReportWritten = true;

    const snap = snapshotForReport();
    const stamp = formatFileTimestamp();
    const reportPath = path.join(logDirPath, `shutdown-${stamp}-pid${process.pid}-code${code ?? 'unknown'}.log`);

    const lines = [];
    lines.push(`Shutdown report @ ${snap.at}`);
    lines.push(`exitCode: ${code}`);
    if (snap.shutdownMeta?.signal) lines.push(`signal: ${snap.shutdownMeta.signal}`);
    if (snap.shutdownMeta?.reason) lines.push(`reason: ${snap.shutdownMeta.reason}`);
    if (snap.shutdownMeta) lines.push(`shutdownMeta: ${safeInspect(snap.shutdownMeta)}`);
    lines.push(`pid: ${snap.pid}`);
    lines.push(`node: ${snap.node}`);
    lines.push(`platform: ${snap.platform}`);
    lines.push(`hostname: ${snap.hostname}`);
    lines.push(`cwd: ${snap.cwd}`);
    if (snap.runLogPath) lines.push(`runLog: ${snap.runLogPath}`);
    lines.push('');

    if (snap.currentActivity?.text) {
        lines.push(`currentActivity @ ${snap.currentActivity.at}`);
        lines.push(snap.currentActivity.text);
        lines.push('');
    }

    if (snap.activityHistory.length > 0) {
        lines.push('recentActivities:');
        for (const entry of snap.activityHistory) {
            lines.push(`- [${entry.at}] ${entry.text}`);
        }
        lines.push('');
    }

    if (snap.lastFatal) {
        lines.push(`lastFatal @ ${snap.lastFatal.at}`);
        lines.push(`type: ${snap.lastFatal.type}`);
        lines.push(safeInspect(snap.lastFatal.value));
        lines.push('');
    }

    lines.push(`lastLogLines (tail ${snap.tail.length}):`);
    lines.push(...snap.tail.map((l) => l.replace(/\n$/, '')));
    lines.push('');

    const reportBody = `${lines.join('\n')}\n`;

    try {
        fs.writeFileSync(reportPath, reportBody, 'utf8');
    } catch {
        // ignore
    }

    // Também deixa um marcador no log de execução pra facilitar achar no mesmo arquivo.
    writeRunLineSync('\n');
    writeRunLineSync(buildLogLine('SHUTDOWN', [`Relatório gerado: ${reportPath}`]));
    writeRunLineSync(reportBody);
};

export const exitWithRuntimeReport = async (code = 0, options = {}) => {
    try {
        writeShutdownReportSync(code);
    } catch {
        // ignore
    }

    try {
        await uploadShutdownReportToMongo(code, options);
    } catch {
        // ignore
    }

    if (originalProcessExit) {
        return originalProcessExit(code);
    }

    return process.exit(code);
};

const installConsoleInterceptor = () => {
    if (originalConsole) return;

    originalConsole = {
        log: console.log.bind(console),
        info: console.info.bind(console),
        warn: console.warn.bind(console),
        error: console.error.bind(console),
        debug: console.debug ? console.debug.bind(console) : console.log.bind(console),
    };

    const wrap = (level, originalFn) => {
        return (...args) => {
            const line = buildLogLine(level, args);
            pushBufferLine(line);
            writeRunLineSync(line);
            return originalFn(...args);
        };
    };

    console.log = wrap('LOG', originalConsole.log);
    console.info = wrap('INFO', originalConsole.info);
    console.warn = wrap('WARN', originalConsole.warn);
    console.error = wrap('ERROR', originalConsole.error);
    console.debug = wrap('DEBUG', originalConsole.debug);
};

const installExitInterceptor = () => {
    if (originalProcessExit) return;
    originalProcessExit = process.exit.bind(process);

    process.exit = ((code = 0) => {
        try {
            writeShutdownReportSync(code);
        } catch {
            // ignore
        }
        return originalProcessExit(code);
    });
};

export const initRuntimeLog = (options = {}) => {
    if (initialized) return { runLogPath };

    maxBufferLines = Number.isFinite(options.maxBufferLines) ? options.maxBufferLines : maxBufferLines;

    const logDir = typeof options.logDir === 'string' && options.logDir.trim().length > 0
        ? options.logDir.trim()
        : 'logs';

    logDirPath = path.resolve(process.cwd(), logDir);
    ensureDirSync(logDirPath);

    const stamp = formatFileTimestamp();
    runLogPath = path.join(logDirPath, `run-${stamp}-pid${process.pid}.log`);

    try {
        logFd = fs.openSync(runLogPath, 'a');
    } catch {
        logFd = null;
    }

    initialized = true;

    installConsoleInterceptor();
    installExitInterceptor();
    process.once('exit', (code) => {
        try {
            writeShutdownReportSync(code);
        } catch {
            // ignore
        }
    });

    // Cabeçalho inicial
    pushBufferLine(buildLogLine('BOOT', [`runLog=${runLogPath}`]));
    writeRunLineSync(buildLogLine('BOOT', [`runLog=${runLogPath}`]));

    return { runLogPath };
};
