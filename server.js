const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.static('converted')); // para servir os .glb

// Configuração do Multer para salvar arquivos .fbx
const storage = multer.diskStorage({
    destination: 'uploads/',
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage });

app.post('/upload', upload.single('model'), (req, res) => {
    const file = req.file;
    if (!file) return res.status(400).send('No file uploaded.');

    const inputPath = path.resolve(file.path);
    const outputName = path.basename(file.filename, path.extname(file.filename)) + '.glb';
    const outputPath = path.resolve('converted', outputName);

    const command = `fbx2gltf -i "${inputPath}" -o "${outputPath}" --binary`;

    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error('Conversion error:', stderr);
            return res.status(500).send('Error converting file.');
        }

        // Devolve a URL para o arquivo .glb
        res.json({
            glbUrl: `http://localhost:${port}/${outputName}`
        });

        // Opcional: limpar o arquivo original após converter
        fs.unlink(inputPath, () => {});
    });
});

app.listen(port, () => {
    console.log(`FBX converter backend running at http://localhost:${port}`);
});
