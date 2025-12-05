const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

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

    socket.on('join_room', (data) => {
        const { roomId, language } = data;

        socket.join(roomId);
        userLanguages[socket.id] = language || "es-ES";

        console.log(`Usuario ${socket.id} (${userLanguages[socket.id]}) -> Sala: ${roomId}`);

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
                socket.emit('user_joined', { otherLanguage: userLanguages[otherSocketId] });
                io.to(otherSocketId).emit('user_joined', { otherLanguage: userLanguages[socket.id] });
            }
        }
    });

    socket.on('send_audio_chunk', (data) => {
        const { roomId, audioData, sourceLang, targetLang } = data;

        const langOrigen = sourceLang || userLanguages[socket.id] || "es-ES";
        const langDestino = targetLang || "en-US";

        procesarStreamAzure(
            socket.id,
            audioData,
            langOrigen,
            langDestino,
            (resultado) => {

                socket.to(roomId).emit('receive_translation', {
                    originalUser: socket.id,
                    originalText: resultado.original,
                    translation: resultado.translated,
                    audioBase64: resultado.audio,
                    translationLanguage: langDestino
                });
            }
        );
    });

    socket.on('end_audio_stream', () => {
        detenerSesion(socket.id);
    });

    socket.on('disconnect', () => {
        detenerSesion(socket.id);
        delete userLanguages[socket.id];
        console.log(`Desconectado: ${socket.id}`);
    });
});

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Servidor Babel LISTO en puerto ${PORT}`);
    console.log(`   - Soporte para Audio Bidireccional: ACTIVO`);
});