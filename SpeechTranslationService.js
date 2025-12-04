const sdk = require("microsoft-cognitiveservices-speech-sdk");
const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

// ... (Configuración de Gemini igual que antes) ...
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

const activeSessions = {};

// Mapa de voces
const voiceMap = {
    'es-ES': 'es-ES-ElviraNeural',
    'en-US': 'en-US-AndrewNeural',
    'fr-FR': 'fr-FR-DeniseNeural',
    'zh-CN': 'zh-CN-XiaoxiaoNeural',
};

// ... (Función procesarStreamAzure igual que antes) ...
function procesarStreamAzure(socketId, audioBuffer, sourceLang, targetLang, callbackResultado) {
    // Código existente de reconocimiento... se mantiene igual.
    // Solo asegúrate de llamar a sintetizarVozAzure dentro del callback tal como lo tenías.
    
    if (!activeSessions[socketId]) {
        if (!process.env.AZURE_SPEECH_KEY || !process.env.AZURE_SPEECH_REGION) {
            console.error("🚨 ERROR: Faltan las claves de AZURE"); 
            return; 
        }

        const speechConfig = sdk.SpeechConfig.fromSubscription(process.env.AZURE_SPEECH_KEY, process.env.AZURE_SPEECH_REGION);
        speechConfig.speechRecognitionLanguage = sourceLang;

        const pushStream = sdk.AudioInputStream.createPushStream();
        const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);
        const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

        recognizer.recognized = async (s, e) => {
            if (e.result.reason === sdk.ResultReason.RecognizedSpeech) {
                const textoOriginal = e.result.text;
                if (!textoOriginal || textoOriginal.trim().length < 2) return;
                
                try {
                    const traduccion = await traducirConGemini(textoOriginal, sourceLang, targetLang);
                    // AQUÍ ESTÁ EL CAMBIO IMPORTANTE: Generar MP3
                    const audioBase64 = await sintetizarVozAzure(traduccion, targetLang);

                    callbackResultado({
                        original: textoOriginal,
                        translated: traduccion,
                        audio: audioBase64 
                    });
                } catch (error) {
                    console.error("Error flujo:", error);
                }
            }
        };
        // ... (resto de eventos canceled, sessionStopped) ...
        recognizer.startContinuousRecognitionAsync();
        activeSessions[socketId] = { recognizer, pushStream };
    }
    // Escribir en stream
    if (activeSessions[socketId]) activeSessions[socketId].pushStream.write(audioBuffer);
}

// ... (Función traducirConGemini igual) ...
async function traducirConGemini(texto, origen, destino) {
    const prompt = `Translate only the text: "${texto}" from ${origen} to ${destino}.`;
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
}

// --- CORRECCIÓN CRÍTICA AQUÍ ---
function sintetizarVozAzure(texto, idiomaDestino) {
    return new Promise((resolve, reject) => {
        const speechConfig = sdk.SpeechConfig.fromSubscription(
            process.env.AZURE_SPEECH_KEY,
            process.env.AZURE_SPEECH_REGION
        );

        const voiceName = voiceMap[idiomaDestino] || 'en-US-AvaMultilingualNeural'; 
        speechConfig.speechSynthesisVoiceName = voiceName;

        // !!! AQUÍ ESTÁ EL ARREGLO !!!
        // Forzamos el formato a MP3 para que Android pueda reproducirlo sin problemas
        speechConfig.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Audio16Khz32KBitRateMonoMp3; 

        const synthesizer = new sdk.SpeechSynthesizer(speechConfig);

        synthesizer.speakTextAsync(
            texto,
            (result) => {
                if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
                    const audioBuffer = result.audioData;
                    const base64Audio = Buffer.from(audioBuffer).toString('base64');
                    synthesizer.close();
                    resolve(base64Audio);
                } else {
                    synthesizer.close();
                    reject(result.errorDetails);
                }
            },
            (err) => {
                synthesizer.close();
                reject(err);
            }
        );
    });
}

// ... (detenerSesion igual) ...
function detenerSesion(socketId) {
    if (activeSessions[socketId]) {
        try {
            activeSessions[socketId].pushStream.close();
            activeSessions[socketId].recognizer.stopContinuousRecognitionAsync(() => {
                activeSessions[socketId].recognizer.close();
            });
        } catch(e) {}
        delete activeSessions[socketId];
    }
}

module.exports = { procesarStreamAzure, detenerSesion };