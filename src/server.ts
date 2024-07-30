import express from 'express';
import path from 'path';
import multer from 'multer';
import fs from 'fs';
import { replaceBarcode } from './replaceBarcode';

const uploadDir = path.resolve(__dirname, 'uploads');
const upload = multer({ dest: uploadDir });

const app = express();
const port = 2700;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.render('index');
});

app.post('/upload', upload.fields([{ name: 'excelFile' }, { name: 'pdfDirectory[]' }]), async (req, res) => {
  if (!req.files || typeof req.files !== 'object') {
    return res.status(400).send('No files uploaded.');
  }

  const files = req.files as { [fieldname: string]: Express.Multer.File[] };
  const excelFiles = files['excelFile'];
  const pdfFiles = files['pdfDirectory[]'];

  if (!excelFiles || excelFiles.length === 0) {
    return res.status(400).send('No Excel file uploaded.');
  }

  if (!pdfFiles || pdfFiles.length === 0) {
    return res.status(400).send('No PDF files uploaded.');
  }

  try {
    pdfFiles.forEach(file => {
      const pdfPath = path.join(file.destination, file.filename);
      const newPdfPath = path.join(file.destination, file.originalname);
      fs.renameSync(pdfPath, newPdfPath);
    });

    const excelFilePath = path.join(uploadDir, excelFiles[0].filename);
    const pdfDirectory = uploadDir;

    console.log('Uploaded Excel file:', excelFiles[0]);
    console.log('Uploaded PDF files:', pdfFiles.map(file => file.originalname));

    const { zipFilePath, messages } = await replaceBarcode(excelFilePath, pdfDirectory);

    console.log('Zip file created at:', zipFilePath);

    res.send({ zipFilePath: path.basename(zipFilePath), messages });
  } catch (error) {
    console.error('Error processing files:', error);
    res.status(500).send('An error occurred while processing files.');
  }
});


app.get('/download/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(uploadDir, filename);

  console.log('Download request for file:', filePath);

  if (fs.existsSync(filePath)) {
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.setHeader('Content-Type', 'application/zip');

    const fileStream = fs.createReadStream(filePath);
    fileStream.on('error', (err) => {
      console.error('Error reading file:', err);
      res.status(500).send('An error occurred while reading the file.');
    });

    fileStream.pipe(res).on('finish', () => {
      // After file is sent, delete the file and clear the directory
      deleteFile(filePath, (err) => {
        if (err) {
          console.error('Error deleting file:', err);
        }
        clearUploadDirectory((err) => {
          if (err) {
            console.error('Error clearing directory:', err);
          }
        });
      });
    });
  } else {
    console.error('File not found:', filePath);
    res.status(404).send('File not found.');
  }
});

// Function to delete a specific file
const deleteFile = (filePath: string, callback: (err?: Error) => void) => {
  fs.unlink(filePath, (err) => {
    if (err) {
      return callback(err);
    }
    callback();
  });
};

// Function to clear the upload directory
const clearUploadDirectory = (callback: (err?: Error) => void) => {
  fs.readdir(uploadDir, (err, files) => {
    if (err) {
      return callback(err);
    }

    const fileDeletions = files.map(file => {
      const filePath = path.join(uploadDir, file);
      return new Promise<void>((resolve, reject) => {
        fs.stat(filePath, (err, stats) => {
          if (err) {
            return reject(err);
          }
          if (stats.isFile()) {
            fs.unlink(filePath, (err) => {
              if (err) {
                return reject(err);
              }
              resolve();
            });
          } else {
            resolve(); // Skip non-files (e.g., directories)
          }
        });
      });
    });

    Promise.all(fileDeletions)
      .then(() => callback())
      .catch(callback);
  });
};



app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
