import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import archiver from 'archiver';

interface BarcodeEntry {
  'Ipd No.': string;
  Barcode: string;
}

const normalize = (input: string | undefined): string => {
  return input ? input.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() : '';
};

export const loadExcelData = (filePath: string): BarcodeEntry[] => {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  return XLSX.utils.sheet_to_json<BarcodeEntry>(sheet);
};

export const replaceBarcode = (excelFilePath: string, pdfDirectory: string): Promise<{ zipFilePath: string; messages: string[] }> => {
  return new Promise((resolve, reject) => {
    const data: BarcodeEntry[] = loadExcelData(excelFilePath);
    const zipPath = path.join(pdfDirectory, 'processed_files.zip');
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    const messages: string[] = [];
    const ipdNoWithoutPdf: Set<string> = new Set();
    const ipdNoWithMissingBarcode: { [key: string]: string[] } = {};

    output.on('close', () => {
      console.log(`Zip file created at ${zipPath} with ${archive.pointer()} total bytes`);
      resolve({ zipFilePath: path.basename(zipPath), messages });
    });

    archive.on('error', (err) => {
      console.error('Archive error:', err);
      reject(err);
    });

    archive.pipe(output);

    data.forEach(entry => {
      const normalizedIpdNo = normalize(entry['Ipd No.']);
      if (!entry['Ipd No.'] && !entry.Barcode) {
        const message = `Invalid entry found: both IPD No. and Barcode are missing.`;
        messages.push(message);
        console.log(message);
        return;
      }

      if (!entry['Ipd No.']) {
        const message = `Invalid entry found: IPD No. is missing. Barcode: ${entry.Barcode}`;
        messages.push(message);
        console.log(message);
        return;
      }

      if (!entry.Barcode) {
        if (!ipdNoWithMissingBarcode[entry['Ipd No.']]) {
          ipdNoWithMissingBarcode[entry['Ipd No.']] = [];
        }
        ipdNoWithMissingBarcode[entry['Ipd No.']].push(entry.Barcode);
        console.log(`Invalid entry found: Barcode is missing. IPD No.: ${entry['Ipd No.']}`);
        return;
      }

      let pdfFound = false;

      fs.readdirSync(pdfDirectory).forEach(file => {
        const normalizedFileName = normalize(path.basename(file, path.extname(file)));
        if (normalizedIpdNo === normalizedFileName) {
          const pdfPath = path.join(pdfDirectory, file);
          const newPdfName = `${entry.Barcode}.pdf`;
          const newPdfPath = path.join(pdfDirectory, newPdfName);

          fs.renameSync(pdfPath, newPdfPath);
          archive.file(newPdfPath, { name: newPdfName });
          pdfFound = true;
        }
      });

      if (!pdfFound) {
        ipdNoWithoutPdf.add(entry['Ipd No.']);
        console.log(`No matching PDF found for IPD No. ${entry['Ipd No.']}`);
      }
    });

    // Construct messages for missing barcodes
    if (Object.keys(ipdNoWithMissingBarcode).length > 0) {
      const missingBarcodeEntries: { [key: string]: string[] } = {};
      for (const [ipdNo, barcodes] of Object.entries(ipdNoWithMissingBarcode)) {
        if (!missingBarcodeEntries[ipdNo]) {
          missingBarcodeEntries[ipdNo] = [];
        }
        missingBarcodeEntries[ipdNo].push(...barcodes);
      }
      
      const ipdNoList = Object.keys(missingBarcodeEntries);
      if (ipdNoList.length > 0) {
        const message = `Invalid entry barcode not found in excel. ${ipdNoList.join(', ')}`;
        messages.push(message);
      }
    }

    // Construct messages for IPD numbers without PDFs
    if (ipdNoWithoutPdf.size > 0) {
      const message = `PDF not Found for this IPD No. ${Array.from(ipdNoWithoutPdf).join(', ')}`;
      messages.push(message);
    }

    archive.finalize();
  });
};
