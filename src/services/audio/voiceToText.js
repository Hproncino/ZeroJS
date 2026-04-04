import { File } from 'node:buffer';

const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'ogg', 'oga', 'opus', 'webm'];

const looksLikeAudio = (attachment) => {
	const name = attachment.name || '';
	const contentType = attachment.contentType || attachment.content_type || '';
	const hasAudioMime = typeof contentType === 'string' && contentType.startsWith('audio/');
	const hasAudioExt = AUDIO_EXTENSIONS.some(ext => name.toLowerCase().endsWith(`.${ext}`));
	return hasAudioMime || hasAudioExt;
};

export const pickFirstAudioAttachment = (attachments) => {
	if (!attachments || attachments.size === 0) return null;
	for (const att of attachments.values()) {
		if (looksLikeAudio(att)) return att;
	}
	return null;
};

export async function transcribeAttachment(openai, attachment) {
	if (!attachment || !attachment.url) return null;
	try {
		const response = await fetch(attachment.url);
		if (!response.ok) {
			console.error(`Falha ao baixar áudio: ${response.status}`);
			return null;
		}
		const arrayBuffer = await response.arrayBuffer();
		const buffer = Buffer.from(arrayBuffer);
		const filename = attachment.name || 'audio.webm';
		const contentType = attachment.contentType || 'application/octet-stream';
		const file = new File([buffer], filename, { type: contentType });

		const result = await openai.audio.transcriptions.create({
			file,
			model: 'whisper-1',
		});

		return result.text || null;
	} catch (err) {
		console.error('Erro ao transcrever áudio:', err);
		return null;
	}
}
