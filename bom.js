/* =========================================================================
 * BOM (bill of materials) — shared by the calculator, the checklist and the
 * printable worksheet. Formulas come from engome.md. All lengths are in mm.
 * ========================================================================= */

export const MATERIALS = {
  chata:      { label: "Barra chata 7/8” x 1/8” de ferro" },
  varao12:    { label: "Varões de 1/2” liso" },
  cantoneira: { label: "Cantoneira 7/8” x 1/8”" },
  varao516:   { label: "Varões 5/16” liso" },
  varao14:    { label: "Varões 1/4” liso" },
  roscada:    { label: "Barra roscada (varão de rosca) 5/16”" },
};

// Each line: id, human label, material key, quantity, length(dims) -> mm,
// formula (human-readable, for the print sheet), partKey (links to 3D model group / checklist)
export const BOM = [
  { id: "arquilha_interna", label: "Arquilha interna de sustentação da Macaíba", material: "chata", qty: 1,
    length: (d) => d.Dmd * Math.PI, formula: "Dmd × π", partKey: "arquilha_interna" },
  { id: "arquilha_externa", label: "Arquilha externa de sustentação da Macaíba", material: "chata", qty: 1,
    length: (d) => d.Dmf * Math.PI, formula: "Dmf × π", partKey: "arquilha_externa" },
  { id: "aro_cima", label: "Aro de cima", material: "chata", qty: 1,
    length: (d) => (d.Dc + 4) * Math.PI, formula: "(Dc + 4mm) × π", partKey: "aro_cima" },
  { id: "aro_baixo", label: "Aro de baixo", material: "chata", qty: 1,
    length: (d) => (d.Db + 4) * Math.PI, formula: "(Db + 4mm) × π", partKey: "aro_baixo" },
  { id: "suportes", label: "Suportes para a Macaíba no aro de baixo", material: "chata", qty: 3,
    length: (d) => ((d.Db + 4) * Math.PI) / 12, formula: "(Db + 4mm) × π ÷ 12", partKey: "suporte" },
  { id: "orelhas", label: "Orelhas", material: "cantoneira", qty: 15,
    length: () => 22.2, formula: "fixo: 7/8” (22,2 mm)", partKey: "orelha" },
  { id: "arquilha_couro", label: "Arquilha do couro", material: "varao14", qty: 1,
    length: (d) => (d.Dc + 8) * Math.PI, formula: "(Dc + 8mm) × π", partKey: "arquilha_couro" },
  { id: "base_circular", label: "Base circular", material: "varao12", qty: 1,
    length: (d) => (d.Dc + 6) * Math.PI, formula: "(Dc + 6mm) × π", partKey: "base_circular" },
  { id: "pes_redonda", label: "Pés — trecho de varão redondo", material: "varao12", qty: 3,
    length: () => 300, formula: "fixo: 30 cm", partKey: "pe" },
  { id: "pes_roscada", label: "Pés — trecho de barra roscada", material: "roscada", qty: 3,
    length: () => 20, formula: "fixo: 2 cm", partKey: "pe" },
  { id: "esticadores_redonda", label: "Esticadores — trecho de varão redondo 5/16”", material: "varao516", qty: 6,
    length: (d) => Math.max(d.Ai + 10 - 75, 0), formula: "(Ai + 1cm) − 75mm", partKey: "esticador" },
  { id: "esticadores_roscada", label: "Esticadores — trecho de barra roscada 5/16”", material: "roscada", qty: 6,
    length: () => 75, formula: "fixo: 75 mm", partKey: "esticador" },
];

// Margem somada ao comprimento de cada peça cortada das barras de metal (folga de corte/acabamento).
export const CUT_MARGIN_MM = 50;

// Comprimento de corte de uma linha da BOM: comprimento da peça + margem.
export function cutLength(item, dims) {
  return item.length(dims) + CUT_MARGIN_MM;
}

// Medidas pedidas ao usuário. As demais (Dmf, Dmd, Ai) são estimadas por deriveDims().
export const DIM_KEYS = ["Dc", "Db", "H"];

export const DIM_INFO = {
  Dc:  { label: "Diâmetro de cima da Macaíba" },
  Db:  { label: "Diâmetro de baixo da Macaíba" },
  H:   { label: "Altura da Macaíba" },
};

// Premissas do bojo, tiradas do modelo 3D (Engome.obj): cone reto com parede de 15 mm.
export const BOJO_ESPESSURA_MM = 15;

/* A partir de Dc, Db e H (mm), completa as medidas usadas nas fórmulas:
 *   Dmf = (Dc + Db) / 2                 (diâmetro de fora na cintura, bojo cônico)
 *   Dmd = Dmf − 2 × espessura da parede (diâmetro de dentro na cintura)
 *   Ai  = √(H² + ((Dc − Db) / 2)²) (comprimento da lateral inclinada) */
export function deriveDims({ Dc, Db, H }) {
  const Dmf = (Dc + Db) / 2;
  const Dmd = Dmf - 2 * BOJO_ESPESSURA_MM;
  const Ai = Math.hypot(H, (Dc - Db) / 2);
  return { Dc, Db, H, Dmf, Dmd, Ai };
}
