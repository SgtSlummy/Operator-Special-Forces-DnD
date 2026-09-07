// Synthetic, original test sheets: no real player data or copied rulebook content.
import { PDFDocument, StandardFonts, degrees, PDFName, PDFDict } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { renderPage } from './pdf.mjs';
export const EXPECTED = { name: 'Maren Ash', classes: 'Ranger 3', level: 3, strength: 12, dexterity: 16,
  constitution: 14, intelligence: 10, wisdom: 15, charisma: 8, armorClass: 15, maxHp: 28,
  currentHp: 19, proficiencyBonus: 2, speed: 30 };
const labels = { name: 'Character Name', classes: 'Class Level', level: 'Level', strength: 'Strength', dexterity: 'Dexterity', constitution: 'Constitution',
  intelligence: 'Intelligence', wisdom: 'Wisdom', charisma: 'Charisma', armorClass: 'Armor Class', maxHp: 'Maximum HP', currentHp: 'Current HP', proficiencyBonus: 'Proficiency Bonus', speed: 'Speed' };
export async function sheetFixture({ kind = 'fillable', rotation = 0, incomplete = false, conflict = false } = {}) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([612, 792]);
  page.drawText('Raphael - synthetic 2024 character sheet', { x: 45, y: 748, size: 18, font });
  const form = pdf.getForm();
  let y = 710;
  for (const [key, value] of Object.entries(EXPECTED)) {
    if (incomplete && key === 'dexterity') continue;
    if (kind === 'fillable') {
      page.drawText(`${labels[key]}:`, { x: 45, y, size: 13, font });
      const field = form.createTextField(labels[key]);
      field.setText(String(value)); field.addToPage(page, { x: 230, y: y - 4, width: 300, height: 20, font, borderWidth: 0 });
      field.setFontSize(13);
    } else page.drawText(`${labels[key]}: ${value}`, { x: 45, y, size: 15, font });
    y -= 34;
  }
  page.drawText('Features: I keep my promises.', { x: 45, y: 175, size: 13, font });
  page.drawText('Equipment: rope, lantern', { x: 45, y: 150, size: 13, font });
  page.drawText('Spells: Light (example text only)', { x: 45, y: 125, size: 13, font });
  if (conflict) page.drawText('Dexterity: 18', { x: 45, y: 100, size: 13, font });
  form.updateFieldAppearances(font);
  if (kind === 'flattened') form.flatten();
  const bytes = await pdf.save();
  if (!['scanned', 'mixed'].includes(kind)) return bytes;
  const loading = getDocument({ data: Uint8Array.from(bytes), isEvalSupported: false });
  const rendering = await loading.promise;
  try {
    const { png } = await renderPage(await rendering.getPage(1), rotation);
    const scanned = await PDFDocument.create();
    const image = await scanned.embedPng(png);
    const rotated = rotation % 180 !== 0;
    const target = scanned.addPage(rotated ? [792, 612] : [612, 792]);
    target.drawImage(image, { x: 0, y: 0, width: target.getWidth(), height: target.getHeight() });
    if (kind === 'mixed') {
      const textFont = await scanned.embedFont(StandardFonts.Helvetica);
      target.drawText('A mixed text and scanned sheet', { x: 20, y: 20, size: 10, font: textFont });
    }
    return scanned.save();
  } finally { await loading.destroy(); }
}
export async function oversizedPageFixture() {
  const pdf = await PDFDocument.create();
  pdf.addPage([14000, 14000]);
  return pdf.save();
}
export async function pageLimitFixture() {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < 31; i++) pdf.addPage();
  return pdf.save();
}
export async function metadataRotatedFixture() {
  const pdf = await PDFDocument.load(await sheetFixture({ kind: 'scanned' }));
  pdf.getPage(0).setRotation(degrees(90));
  return pdf.save();
}
export async function encryptedFixture() {
  const pdf = await PDFDocument.load(await sheetFixture());
  // An encrypted-document marker is enough to prove the importer rejects the
  // encrypted branch rather than asking for, storing, or bypassing a password.
  const dictionary = PDFDict.withContext(pdf.context);
  dictionary.set(PDFName.of('Filter'), PDFName.of('Standard'));
  pdf.context.trailerInfo.Encrypt = pdf.context.register(dictionary);
  return pdf.save();
}
