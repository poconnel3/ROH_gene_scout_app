const DEFAULT_ENSEMBL_GRCH37_BASE = "https://grch37.rest.ensembl.org";
const DEFAULT_HPO_GENE_DISEASE_URL = "https://purl.obolibrary.org/obo/hp/hpoa/genes_to_disease.txt";
const DEFAULT_HPO_PHENOTYPE_URL = "https://purl.obolibrary.org/obo/hp/hpoa/phenotype.hpoa";
const DEFAULT_HPO_GENE_PHENOTYPE_URL = "https://purl.obolibrary.org/obo/hp/hpoa/genes_to_phenotype.txt";
const MAX_ENSEMBL_REGION_LENGTH = 5_000_000;

const AR_TERM = "HP:0000007";
const XLR_TERM = "HP:0001419";
const INHERITANCE_TERM_IDS = new Set([
  "HP:0000005",
  "HP:0000006",
  AR_TERM,
  "HP:0001417",
  XLR_TERM,
  "HP:0001423",
  "HP:0001450"
]);
const INHERITANCE_LABELS = {
  [AR_TERM]: "Autosomal recessive",
  [XLR_TERM]: "X-linked recessive"
};

let hpoAnnotationCachePromise = null;

export async function analyzeIntervalsWithPublicAnnotations(intervals, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const hpo = options.hpoAnnotations || (await loadHpoAnnotations({ fetchImpl }));
  const warnings = [];
  const results = [];

  for (const interval of intervals) {
    const ensemblGenes = await fetchEnsemblGenesForInterval(interval, {
      fetchImpl,
      ensemblBase: options.ensemblBase || process.env.ENSEMBL_GRCH37_BASE || DEFAULT_ENSEMBL_GRCH37_BASE
    });
    const genes = filterGenesByRecessiveAnnotations(ensemblGenes, hpo, interval);

    if (genes.length === 0) {
      warnings.push(`No HPO ${getInheritanceLabel(interval)} disease genes were returned for ${formatInterval(interval)}.`);
    }

    results.push({
      interval,
      genes,
      geneCount: genes.length,
      phenotypeCount: genes.reduce((count, gene) => count + gene.phenotypes.length, 0)
    });
  }

  return {
    intervals,
    results,
    warnings,
    source: {
      name: "Ensembl GRCh37 + HPO public annotations",
      genomeBuild: "GRCh37/hg19 input coordinates",
      note: "Gene overlap uses Ensembl GRCh37. Disease-gene, inheritance, and HPO phenotype-term filtering use HPO annotations with OMIM disease identifiers, selecting autosomal recessive phenotypes for chromosomes 1-22 and X-linked recessive phenotypes for chrX."
    },
    generatedAt: new Date().toISOString()
  };
}

export async function fetchEnsemblGenesForInterval(interval, { fetchImpl = fetch, ensemblBase = DEFAULT_ENSEMBL_GRCH37_BASE } = {}) {
  const chunks = splitIntervalForEnsembl(interval);
  const genesByKey = new Map();

  for (const chunk of chunks) {
    const url = buildEnsemblOverlapUrl(chunk, ensemblBase);
    const response = await fetchImpl(url, {
      headers: {
        accept: "application/json",
        "content-type": "application/json"
      },
      cache: "no-store"
    });

    if (!response.ok) {
      const body = await safeReadText(response);
      const error = new Error(`Ensembl GRCh37 overlap request failed with HTTP ${response.status}.`);
      error.status = response.status;
      error.body = body;
      throw error;
    }

    const payload = await response.json();
    const records = Array.isArray(payload) ? payload : [];
    for (const record of records) {
      const gene = normalizeEnsemblGene(record, interval);
      if (!gene) continue;
      const key = gene.ensemblGeneId || `${gene.geneSymbol}:${gene.geneStart}:${gene.geneEnd}`;
      genesByKey.set(key, gene);
    }
  }

  return [...genesByKey.values()].sort(compareGenes);
}

export function splitIntervalForEnsembl(interval) {
  const chunks = [];
  for (let start = interval.start; start <= interval.end; start += MAX_ENSEMBL_REGION_LENGTH) {
    chunks.push({
      chromosome: interval.chromosome,
      start,
      end: Math.min(interval.end, start + MAX_ENSEMBL_REGION_LENGTH - 1)
    });
  }
  return chunks;
}

export async function loadHpoAnnotations({
  fetchImpl = fetch,
  geneDiseaseUrl = process.env.HPO_GENE_DISEASE_URL || DEFAULT_HPO_GENE_DISEASE_URL,
  phenotypeUrl = process.env.HPO_PHENOTYPE_URL || DEFAULT_HPO_PHENOTYPE_URL,
  genePhenotypeUrl = process.env.HPO_GENE_PHENOTYPE_URL || DEFAULT_HPO_GENE_PHENOTYPE_URL
} = {}) {
  if (!hpoAnnotationCachePromise) {
    hpoAnnotationCachePromise = fetchHpoAnnotations({ fetchImpl, geneDiseaseUrl, phenotypeUrl, genePhenotypeUrl }).catch((error) => {
      hpoAnnotationCachePromise = null;
      throw error;
    });
  }
  return hpoAnnotationCachePromise;
}

export function clearHpoAnnotationCache() {
  hpoAnnotationCachePromise = null;
}

export async function fetchHpoAnnotations({ fetchImpl = fetch, geneDiseaseUrl, phenotypeUrl, genePhenotypeUrl }) {
  const [geneDiseaseResponse, phenotypeResponse, genePhenotypeResponse] = await Promise.all([
    fetchImpl(geneDiseaseUrl, { cache: "no-store" }),
    fetchImpl(phenotypeUrl, { cache: "no-store" }),
    fetchImpl(genePhenotypeUrl, { cache: "no-store" })
  ]);

  if (!geneDiseaseResponse.ok) {
    const error = new Error(`HPO gene-disease annotation request failed with HTTP ${geneDiseaseResponse.status}.`);
    error.status = geneDiseaseResponse.status;
    throw error;
  }

  if (!phenotypeResponse.ok) {
    const error = new Error(`HPO phenotype annotation request failed with HTTP ${phenotypeResponse.status}.`);
    error.status = phenotypeResponse.status;
    throw error;
  }

  if (!genePhenotypeResponse.ok) {
    const error = new Error(`HPO gene-phenotype annotation request failed with HTTP ${genePhenotypeResponse.status}.`);
    error.status = genePhenotypeResponse.status;
    throw error;
  }

  const [geneDiseaseText, phenotypeText, genePhenotypeText] = await Promise.all([
    geneDiseaseResponse.text(),
    phenotypeResponse.text(),
    genePhenotypeResponse.text()
  ]);
  return buildHpoAnnotationIndex(geneDiseaseText, phenotypeText, genePhenotypeText);
}

export function buildHpoAnnotationIndex(geneDiseaseText, phenotypeText, genePhenotypeText = "") {
  const diseaseDetails = parseHpoPhenotypeRows(phenotypeText);
  const hpoTermsByAssociation = buildHpoTermsByAssociation(parseHpoGenePhenotypeRows(genePhenotypeText));
  const geneDiseaseBySymbol = new Map();

  for (const association of parseHpoGeneDiseaseRows(geneDiseaseText)) {
    if (!association.geneSymbol || !association.diseaseId) continue;
    if (association.associationType && association.associationType !== "MENDELIAN") continue;
    if (!isOmimDiseaseId(association.diseaseId)) continue;

    const disease = diseaseDetails.get(association.diseaseId);
    if (!disease || disease.inheritanceTerms.size === 0) continue;

    const key = association.geneSymbol.toUpperCase();
    const list = geneDiseaseBySymbol.get(key) || [];
    list.push({
      ...association,
      diseaseName: disease.diseaseName || association.diseaseId,
      inheritanceTerms: disease.inheritanceTerms,
      hpoTerms: hpoTermsByAssociation.get(getAssociationKey(association.geneSymbol, association.diseaseId)) || []
    });
    geneDiseaseBySymbol.set(key, list);
  }

  return {
    geneDiseaseBySymbol,
    diseaseDetails,
    hpoTermsByAssociation
  };
}

export function parseHpoGeneDiseaseRows(text) {
  const rows = parseTsvWithHeader(text, ["ncbi_gene_id", "gene_symbol", "association_type", "disease_id", "source"]);

  return rows
    .map((row) => ({
      ncbiGeneId: getField(row, "ncbi_gene_id", "ncbigene_id", "gene_id"),
      geneSymbol: cleanGeneSymbol(getField(row, "gene_symbol", "genesymbol", "symbol")),
      associationType: String(getField(row, "association_type", "association") || "").toUpperCase(),
      diseaseId: normalizeDiseaseId(getField(row, "disease_id", "diseaseid", "database_id", "databaseid")),
      source: getField(row, "source")
    }))
    .filter((row) => row.geneSymbol && row.diseaseId);
}

export function parseHpoPhenotypeRows(text) {
  const rows = parseTsvWithHeader(text, [
    "database_id",
    "disease_name",
    "qualifier",
    "hpo_id",
    "reference",
    "evidence",
    "onset",
    "frequency",
    "sex",
    "modifier",
    "aspect",
    "biocuration"
  ]);
  const diseaseDetails = new Map();

  for (const row of rows) {
    const diseaseId = normalizeDiseaseId(getField(row, "database_id", "databaseid", "disease_id", "diseaseid"));
    if (!diseaseId) continue;

    const current =
      diseaseDetails.get(diseaseId) ||
      {
        diseaseId,
        diseaseName: getField(row, "disease_name", "diseasename", "name"),
        inheritanceTerms: new Set()
      };

    if (!current.diseaseName) current.diseaseName = getField(row, "disease_name", "diseasename", "name");

    const qualifier = String(getField(row, "qualifier") || "").toUpperCase();
    const hpoId = getField(row, "hpo_id", "hpoid");
    if (qualifier !== "NOT" && (hpoId === AR_TERM || hpoId === XLR_TERM)) {
      current.inheritanceTerms.add(hpoId);
    }

    diseaseDetails.set(diseaseId, current);
  }

  return diseaseDetails;
}

export function parseHpoGenePhenotypeRows(text) {
  const rows = parseTsvWithHeader(text, ["ncbi_gene_id", "gene_symbol", "hpo_id", "hpo_name", "frequency", "disease_id"]);

  return rows
    .map((row) => ({
      ncbiGeneId: getField(row, "ncbi_gene_id", "ncbigene_id", "gene_id"),
      geneSymbol: cleanGeneSymbol(getField(row, "gene_symbol", "genesymbol", "symbol")),
      hpoId: getField(row, "hpo_id", "hpoid"),
      name: getField(row, "hpo_name", "hponame", "name", "term_name"),
      frequency: getField(row, "frequency"),
      diseaseId: normalizeDiseaseId(getField(row, "disease_id", "diseaseid", "database_id", "databaseid"))
    }))
    .filter((row) => row.geneSymbol && row.hpoId && row.name && row.diseaseId);
}

function buildHpoTermsByAssociation(rows) {
  const map = new Map();

  for (const row of rows) {
    if (!isOmimDiseaseId(row.diseaseId)) continue;
    if (INHERITANCE_TERM_IDS.has(row.hpoId)) continue;

    const key = getAssociationKey(row.geneSymbol, row.diseaseId);
    const terms = map.get(key) || [];
    if (!terms.some((term) => term.hpoId === row.hpoId || term.name === row.name)) {
      terms.push({
        hpoId: row.hpoId,
        name: row.name,
        frequency: row.frequency && row.frequency !== "-" ? row.frequency : ""
      });
    }
    map.set(key, terms);
  }

  for (const terms of map.values()) {
    terms.sort((a, b) => a.name.localeCompare(b.name));
  }

  return map;
}

function stripHpoIds(terms = []) {
  return terms.map((term) => ({
    name: term.name,
    frequency: term.frequency || ""
  }));
}

export function filterGenesByRecessiveAnnotations(ensemblGenes, hpoAnnotations, interval) {
  const targetTerm = interval?.chromosome === "chrX" ? XLR_TERM : AR_TERM;
  const grouped = new Map();

  for (const gene of ensemblGenes) {
    const associations = hpoAnnotations.geneDiseaseBySymbol.get(gene.geneSymbol.toUpperCase()) || [];
    const phenotypes = associations
      .filter((association) => association.inheritanceTerms.has(targetTerm))
      .map((association) => ({
        name: association.diseaseName,
        phenotypeMimNumber: getOmimNumber(association.diseaseId),
        inheritance: INHERITANCE_LABELS[targetTerm],
        diseaseId: association.diseaseId,
        hpoTerms: stripHpoIds(association.hpoTerms),
        mappingKey: association.associationType || "",
        source: association.source || ""
      }));

    if (phenotypes.length === 0) continue;

    const key = gene.ensemblGeneId || gene.geneSymbol;
    const existing =
      grouped.get(key) ||
      {
        ...gene,
        phenotypes: []
      };

    for (const phenotype of phenotypes) {
      if (!existing.phenotypes.some((item) => item.diseaseId === phenotype.diseaseId)) {
        existing.phenotypes.push(phenotype);
      }
    }
    grouped.set(key, existing);
  }

  return [...grouped.values()].sort(compareGenes);
}

export function isAutosomalRecessiveInheritance(value) {
  if (!value) return false;
  const normalized = Array.isArray(value) ? value.join("; ") : String(value);
  return /\bautosomal\s+recessive\b/i.test(normalized) || /(^|[;,\s])AR($|[;,\s])/i.test(normalized);
}

export function isXLinkedRecessiveInheritance(value) {
  if (!value) return false;
  const normalized = Array.isArray(value) ? value.join("; ") : String(value);
  return /\bx[\s-]?linked\s+recessive\b/i.test(normalized) || /(^|[;,\s])XLR($|[;,\s])/i.test(normalized);
}

function buildEnsemblOverlapUrl(interval, ensemblBase) {
  const chromosome = interval.chromosome.replace(/^chr/i, "");
  const url = new URL(`/overlap/region/human/${chromosome}:${interval.start}-${interval.end}`, ensemblBase.replace(/\/$/, ""));
  url.searchParams.set("feature", "gene");
  url.searchParams.set("content-type", "application/json");
  return url;
}

function normalizeEnsemblGene(record, interval) {
  const geneSymbol = cleanGeneSymbol(firstNonEmpty(record.external_name, record.display_name, record.gene_symbol, record.id));
  if (!geneSymbol) return null;

  const geneStart = parseNullableInteger(record.start);
  const geneEnd = parseNullableInteger(record.end);

  return {
    geneSymbol,
    geneName: cleanEnsemblDescription(firstNonEmpty(record.description, record.external_name)),
    geneMimNumber: "",
    ensemblGeneId: firstNonEmpty(record.id, record.gene_id),
    geneStart,
    geneEnd,
    geneBiotype: firstNonEmpty(record.biotype, record.gene_biotype),
    region: formatInterval(interval),
    overlapStatus: getOverlapStatus(interval, geneStart, geneEnd),
    phenotypes: []
  };
}

function parseTsvWithHeader(text, fallbackHeaders) {
  const rows = [];
  let headers = null;

  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line) continue;

    const withoutComment = line.startsWith("#") ? line.slice(1) : line;
    const fields = withoutComment.split("\t");
    if (!headers && looksLikeHeader(fields, fallbackHeaders)) {
      headers = fields.map(normalizeHeaderName);
      continue;
    }

    if (line.startsWith("#")) continue;

    const activeHeaders = headers || fallbackHeaders.map(normalizeHeaderName);
    const row = {};
    for (let index = 0; index < activeHeaders.length; index += 1) {
      row[activeHeaders[index]] = fields[index] || "";
    }
    rows.push(row);
  }

  return rows;
}

function looksLikeHeader(fields, fallbackHeaders) {
  const normalizedFields = fields.map(normalizeHeaderName);
  const expected = new Set(fallbackHeaders.map(normalizeHeaderName));
  return normalizedFields.some((field) => expected.has(field)) && normalizedFields.some((field) => /gene|disease|hpo|database/.test(field));
}

function normalizeHeaderName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^#/, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function getField(row, ...names) {
  for (const name of names) {
    const normalized = normalizeHeaderName(name);
    if (row[normalized] !== undefined && String(row[normalized]).trim() !== "") return String(row[normalized]).trim();
  }
  return "";
}

function normalizeDiseaseId(value) {
  const id = String(value || "").trim().toUpperCase();
  if (!id) return "";
  return id.replace(/^MIM:/, "OMIM:");
}

function getAssociationKey(geneSymbol, diseaseId) {
  return `${String(geneSymbol || "").toUpperCase()}|${normalizeDiseaseId(diseaseId)}`;
}

function getOmimNumber(diseaseId) {
  const match = String(diseaseId || "").match(/^(?:OMIM|MIM):(\d+)$/i);
  return match ? match[1] : "";
}

function isOmimDiseaseId(diseaseId) {
  return /^(?:OMIM|MIM):\d+$/i.test(String(diseaseId || ""));
}

function getOverlapStatus(interval, geneStart, geneEnd) {
  if (!Number.isFinite(geneStart) || !Number.isFinite(geneEnd)) return "reported by Ensembl";
  const spansStart = geneStart < interval.start && geneEnd >= interval.start;
  const spansEnd = geneStart <= interval.end && geneEnd > interval.end;
  if (spansStart && spansEnd) return "spans both breakpoints";
  if (spansStart) return "spans start";
  if (spansEnd) return "spans end";
  if (geneStart >= interval.start && geneEnd <= interval.end) return "within region";
  return "overlaps region";
}

function compareGenes(a, b) {
  const aStart = a.geneStart ?? Number.MAX_SAFE_INTEGER;
  const bStart = b.geneStart ?? Number.MAX_SAFE_INTEGER;
  if (aStart !== bStart) return aStart - bStart;
  return a.geneSymbol.localeCompare(b.geneSymbol);
}

function parseNullableInteger(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number.parseInt(String(value).replace(/,/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (Array.isArray(value) && value.length > 0) return value[0];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

function cleanGeneSymbol(value) {
  return String(value || "").split(",")[0].trim();
}

function cleanEnsemblDescription(value) {
  return String(value || "")
    .replace(/\s*\[Source:.*?\]\s*$/i, "")
    .trim();
}

function formatInterval(interval) {
  return `${interval.chromosome}:${interval.start}-${interval.end}`;
}

function getInheritanceLabel(interval) {
  return interval?.chromosome === "chrX" ? "X-linked recessive" : "autosomal recessive";
}

async function safeReadText(response) {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return "";
  }
}
