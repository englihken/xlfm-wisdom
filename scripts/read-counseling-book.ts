const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');

const PDF_PATH = 'C:\\Users\\Ken\\Documents\\弘法度人辅导手册.pdf';
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'hongfa-duren-shouce.txt');

async function main() {
  console.log(`Reading PDF: ${PDF_PATH}`);
  const buffer = fs.readFileSync(PDF_PATH);
  const data = await pdfParse(buffer);

  console.log(`Pages: ${data.numpages}`);
  console.log(`Text length: ${data.text.length} characters`);

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, data.text, 'utf-8');
  console.log(`Saved to: ${OUTPUT_PATH}`);

  console.log('\n--- First 3000 characters ---\n');
  console.log(data.text.slice(0, 3000));
}

main().catch(console.error);
