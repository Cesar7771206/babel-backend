const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

// Asegúrate de que este archivo sea el que modificamos en el paso anterior
const { procesarStreamAzure, detenerSesion } = require('./SpeechTranslationService');

const app = express();
app.use(cors());
const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const userLanguages = {};

io.on('connection', (socket) => {
    console.log(`📱 Nuevo dispositivo conectado: ${socket.id}`);

    // 1. Unirse a una sala (Escenario QR o Código Manual)
    socket.on('join_room', (data) => {
        const { roomId, language } = data;
        
        socket.join(roomId);
        userLanguages[socket.id] = language || "es-ES"; 
        
        console.log(`Usuario ${socket.id} (${userLanguages[socket.id]}) -> Sala: ${roomId}`);

        // Notificar a otros usuarios en la sala para sincronizar idiomas
        const roomSockets = io.sockets.adapter.rooms.get(roomId);
        if (roomSockets && roomSockets.size > 1) {
            let otherSocketId = null;
            for (const id of roomSockets) {
                if (id !== socket.id) {
                    otherSocketId = id;
                    break;
                }
            }

            if (otherSocketId) {
                // Intercambio de configuraciones de idioma
                socket.emit('user_joined', { otherLanguage: userLanguages[otherSocketId] });
                io.to(otherSocketId).emit('user_joined', { otherLanguage: userLanguages[socket.id] });
            }
        }
    });

    // 2. Recepción de audio del micrófono del celular
    socket.on('send_audio_chunk', (data) => {
        const { roomId, audioData, sourceLang, targetLang } = data;
        
        // Determinar idiomas (prioridad: dato enviado > guardado > defecto)
        const langOrigen = sourceLang || userLanguages[socket.id] || "es-ES";
        const langDestino = targetLang || "en-US"; 

        procesarStreamAzure(
            socket.id, 
            audioData, 
            langOrigen, 
            langDestino, 
            (resultado) => {
                // 'resultado' ahora trae: { original, translated, audio }
                
                // Enviamos la traducción y el AUDIO a la sala (al otro usuario)
                socket.to(roomId).emit('receive_translation', {
                    originalUser: socket.id,
                    originalText: resultado.original,
                    translation: resultado.translated,
                    audioBase64: resultado.audio, // <--- AQUÍ VA EL AUDIO PARA ANDROID
                    translationLanguage: langDestino 
                });
            }
        );
    });

    // 3. Finalizar flujo
    socket.on('end_audio_stream', () => {
        detenerSesion(socket.id);
    });

    socket.on('disconnect', () => {
        detenerSesion(socket.id);
        delete userLanguages[socket.id];
        console.log(`Desconectado: ${socket.id}`);
    });
});

const PORT = 3000; // O el puerto que prefieras
server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Servidor Babel LISTO en puerto ${PORT}`);
    console.log(`   - Soporte para Audio Bidireccional: ACTIVO`);
});