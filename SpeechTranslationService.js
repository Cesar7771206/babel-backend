const sdk = require("microsoft-cognitiveservices-speech-sdk");
const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

if (!process.env.GEMINI_API_KEY) {
    console.error("\n🚨 ERROR FATAL: No se encontró la GEMINI_API_KEY.");
    console.error("   Asegúrate de tener un archivo .env con la clave correcta.\n");
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

const activeSessions = {};

function procesarStreamAzure(socketId, audioBuffer, sourceLang, targetLang, callbackTexto) {

   

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
                console.log(`👂 Oído: "${textoOriginal}"`);
              
                try {
                    const traduccion = await traducirConGemini(textoOriginal, sourceLang, targetLang);
                    console.log(`🧠 Traducido: "${traduccion}"`);
                    callbackTexto(traduccion);
                } catch (error) {
                    console.error("\n❌ ERROR EN GEMINI:");
                    if (error.message) console.error("   Mensaje:", error.message);
                    if (error.response && error.response.promptFeedback) {
                        console.error("   Bloqueo de Seguridad:", error.response.promptFeedback);
                    }
                    console.error("------------------------------------------------\n");
                    callbackTexto(textoOriginal);
                }
            }
        };

        recognizer.canceled = (s, e) => {
            console.log(`❌ Azure Cancelado: ${e.reason}`);
            if (e.reason === sdk.CancellationReason.Error) {
                console.error(`   Detalle: ${e.errorDetails}`);
            }
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



async function traducirConGemini(texto, origen, destino) {
    const prompt = `Translate the following spoken text from ${origen} to ${destino}.
    Be natural, acting as a professional interpreter. Do not be literal.
    Only output the translation.
    Text: "${texto}"`;
1
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text().trim();

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

