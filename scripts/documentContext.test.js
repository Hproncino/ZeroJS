import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
    appendDocumentReference,
    formatDocumentReference,
    ingestDocumentAttachments,
    judgeRelevantDocuments,
    selectRelevantDocumentContext,
} from '../src/services/documentContextService.js';

const documents = [
    { id: 'doc-a', name: 'manual.pdf', text: 'O prazo de garantia é de dois anos.' },
    { id: 'doc-b', name: 'contrato.docx', text: 'O contrato inicia em janeiro.' },
    { id: 'doc-c', name: 'notas.pdf', text: 'Uma anotação sem relação.' },
];

const mockOpenAI = (payload) => ({
    chat: {
        completions: {
            create: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
        },
    },
});

function createPdf(text) {
    const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    ];
    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    for (let index = 0; index < objects.length; index += 1) {
        offsets.push(Buffer.byteLength(pdf));
        pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
    }
    const xrefOffset = Buffer.byteLength(pdf);
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    return Buffer.from(pdf);
}

async function assertExtractedDocument({ name, buffer, expectedText }) {
    const originalFetch = globalThis.fetch;
    const scope = `extraction-test-${name}`;
    globalThis.fetch = async () => new Response(buffer, { status: 200 });
    try {
        const ingestion = await ingestDocumentAttachments(
            new Map([['file', { name, contentType: '', url: 'https://unit.test/document' }]]),
            scope
        );
        assert.equal(ingestion[0]?.ok, true, ingestion[0]?.reason);

        let extractedCandidate = '';
        const openai = {
            chat: {
                completions: {
                    create: async ({ messages }) => {
                        const request = JSON.parse(messages[1].content);
                        extractedCandidate = request.documents[0].excerpt;
                        return { choices: [{ message: { content: JSON.stringify({ relevantIds: [request.documents[0].id] }) } }] };
                    },
                },
            },
        };
        const context = await selectRelevantDocumentContext(openai, scope, 'Resuma o arquivo');
        assert.match(extractedCandidate, new RegExp(expectedText));
        assert.match(context, new RegExp(expectedText));
    } finally {
        globalThis.fetch = originalFetch;
    }
}

test('não chama o julgador sem mensagem ou documentos', async () => {
    const openai = { chat: { completions: { create: async () => assert.fail('não deveria chamar API') } } };
    assert.deepEqual(await judgeRelevantDocuments(openai, [], 'Consulte o arquivo'), []);
    assert.deepEqual(await judgeRelevantDocuments(openai, documents, '   '), []);
});

test('não seleciona documentos quando o assunto atual mudou', async () => {
    const selected = await judgeRelevantDocuments(
        mockOpenAI({ relevantIds: [] }),
        documents,
        'Qual é a previsão do tempo para amanhã?',
        [{ role: 'user', content: 'Antes, perguntei sobre a garantia.' }]
    );
    assert.deepEqual(selected, []);
    assert.equal(formatDocumentReference(selected), '');
});

test('inclui somente os IDs selecionados e limita a dois documentos', async () => {
    const selected = await judgeRelevantDocuments(
        mockOpenAI({ relevantIds: ['doc-a', 'doc-b', 'doc-c', 'unknown'] }),
        documents,
        'Qual é o prazo de garantia?'
    );
    assert.deepEqual(selected.map(({ id }) => id), ['doc-a', 'doc-b']);
    const reference = formatDocumentReference(selected);
    assert.match(reference, /REFERÊNCIA DE ARQUIVO NÃO CONFIÁVEL/);
    assert.match(reference, /<conteudo_nao_confiavel>/);
    assert.equal(reference.includes('notas.pdf'), false);
});

test('um erro do julgador falha sem anexar qualquer documento', async () => {
    const openai = { chat: { completions: { create: async () => { throw new Error('offline'); } } } };
    const selected = await judgeRelevantDocuments(openai, documents, 'Responda com base no arquivo');
    assert.deepEqual(selected, []);
});

test('a referência do arquivo é uma mensagem de usuário separada antes da pergunta atual', () => {
    const messages = [{ role: 'system', content: 'instruções do bot' }];
    const reference = formatDocumentReference([documents[0]]);
    appendDocumentReference(messages, reference);
    messages.push({ role: 'user', content: 'Qual é o prazo de garantia?' });

    assert.equal(messages[1].role, 'user');
    assert.equal(messages[1].name, 'document_reference');
    assert.equal(messages[1].content, reference);
    assert.equal(messages[2].content, 'Qual é o prazo de garantia?');
    assert.equal(messages.some((item) => item.role === 'system' && item.content.includes(documents[0].text)), false);
});

test('extrai texto de PDF e DOCX e disponibiliza o texto para seleção isolada', async () => {
    const docx = await readFile(join(process.cwd(), 'node_modules/mammoth/test/test-data/embedded-style-map.docx'));
    await assertExtractedDocument({
        name: 'sample.pdf',
        buffer: createPdf('Warranty is 24 months'),
        expectedText: 'Warranty is 24 months',
    });
    await assertExtractedDocument({
        name: 'sample.docx',
        buffer: docx,
        expectedText: 'Walking on imported air',
    });
});
