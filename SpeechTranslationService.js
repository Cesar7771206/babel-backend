const sdk = require("microsoft-cognitiveservices-speech-sdk");
const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

if (!process.env.GEMINI_API_KEY) {
    console.error("\n🚨 ERROR FATAL: No se encontró la GEMINI_API_KEY.");
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

const activeSessions = {};

// Mapa de voces neuronales de Azure según el idioma
const voiceMap = {
    'es-ES': 'es-ES-ElviraNeural',
    'en-US': 'en-US-AndrewNeural',
    'fr-FR': 'fr-FR-DeniseNeural',
    'zh-CN': 'zh-CN-XiaoxiaoNeural',
    // Puedes añadir más aquí. Si llega un idioma desconocido, Azure usará uno por defecto si se configura auto.
};

function procesarStreamAzure(socketId, audioBuffer, sourceLang, targetLang, callbackResultado) {

    if (!activeSessions[socketId]) {
        console.log(`🔵 Iniciando sesión para: ${socketId} (${sourceLang} -> ${targetLang})`);
        
        if (!process.env.AZURE_SPEECH_KEY || !process.env.AZURE_SPEECH_REGION) {
            console.error("🚨 ERROR: Faltan las claves de AZURE en el .env");
            return;
        }

        const speechConfig = sdk.SpeechConfig.fromSubscription(
            process.env.AZURE_SPEECH_KEY,
            process.env.AZURE_SPEECH_REGION
        );

        speechConfig.speechRecognitionLanguage = sourceLang;

        const pushStream = sdk.AudioInputStream.createPushStream();
        const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);
        const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

        recognizer.recognized = async (s, e) => {
            if (e.result.reason === sdk.ResultReason.RecognizedSpeech) {
                const textoOriginal = e.result.text;
                if (!textoOriginal || textoOriginal.trim().length < 2) return;
                
                console.log(`👂 Oído (${sourceLang}): "${textoOriginal}"`);
              
                try {
                    // 1. Traducir con Gemini
                    const traduccion = await traducirConGemini(textoOriginal, sourceLang, targetLang);
                    console.log(`🧠 Traducido (${targetLang}): "${traduccion}"`);
                    
                    // 2. NUEVO: Convertir Texto a Audio (TTS)
                    const audioBase64 = await sintetizarVozAzure(traduccion, targetLang);

                    // 3. Enviar ambos datos (Texto y Audio) al frontend
                    callbackResultado({
                        original: textoOriginal,
                        translated: traduccion,
                        audio: audioBase64 // Esto es lo que reproducirá Android
                    });

                } catch (error) {
                    console.error("❌ Error en flujo de traducción/audio:", error);
                    callbackResultado({
                        original: textoOriginal,
                        translated: "Error translating",
                        audio: null
                    });
                }
            }
        };

        recognizer.canceled = (s, e) => {
            console.log(`❌ Azure Cancelado: ${e.reason}`);
            detenerSesion(socketId);
        };

        recognizer.sessionStopped = (s, e) => {
            detenerSesion(socketId);
        };

        recognizer.startContinuousRecognitionAsync();

        activeSessions[socketId] = {
            recognizer: recognizer,
            pushStream: pushStream
        };
    }

    try {
        const session = activeSessions[socketId];
        if (session && session.pushStream) {
            session.pushStream.write(audioBuffer);
        }
    } catch (error) {
        console.error("Error stream audio:", error);
    }
}

// --- FUNCIONES AUXILIARES ---

async function traducirConGemini(texto, origen, destino) {
    const prompt = `Translate the following spoken text from ${origen} to ${destino}.
    Be natural, acting as a professional interpreter. Do not be literal.
    Only output the translation, no extra text.
    Text: "${texto}"`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text().trim();
}

// NUEVA FUNCIÓN: Genera el audio de retorno
function sintetizarVozAzure(texto, idiomaDestino) {
    return new Promise((resolve, reject) => {
        const speechConfig = sdk.SpeechConfig.fromSubscription(
            process.env.AZURE_SPEECH_KEY,
            process.env.AZURE_SPEECH_REGION
        );

        // Seleccionar voz basada en el idioma de destino
        const voiceName = voiceMap[idiomaDestino] || 'en-US-AvaMultilingualNeural'; 
        speechConfig.speechSynthesisVoiceName = voiceName;

        const synthesizer = new sdk.SpeechSynthesizer(speechConfig);

        synthesizer.speakTextAsync(
            texto,
            (result) => {
                if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
                    // Convertimos el buffer de audio a Base64 para enviarlo fácil por socket
                    const audioBuffer = result.audioData;
                    const base64Audio = Buffer.from(audioBuffer).toString('base64');
                    synthesizer.close();
                    resolve(base64Audio);
                } else {
                    console.error("TTS Error:", result.errorDetails);
                    synthesizer.close();
                    reject(result.errorDetails);
                }
            },
            (err) => {
                console.error("TTS Fatal Error:", err);
                synthesizer.close();
                reject(err);
            }
        );
    });
}

function detenerSesion(socketId) {
    if (activeSessions[socketId]) {
        const { recognizer, pushStream } = activeSessions[socketId];
        try {
            pushStream.close();
            recognizer.stopContinuousRecognitionAsync(() => {
                recognizer.close();
            });
        } catch(e) {}
        delete activeSessions[socketId];
    }
}

module.exports = { procesarStreamAzure, detenerSesion };