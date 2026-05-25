import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeIntervalsWithPublicAnnotations,
  buildHpoAnnotationIndex,
  filterGenesByRecessiveAnnotations,
  isAutosomalRecessiveInheritance,
  isXLinkedRecessiveInheritance,
  parseHpoGeneDiseaseRows,
  parseHpoGenePhenotypeRows,
  parseHpoPhenotypeRows,
  splitIntervalForEnsembl
} from "../lib/recessive-annotations.js";

const interval = { chromosome: "chr2", start: 1000, end: 9_000_000 };

const geneDiseaseText = `ncbi_gene_id\tgene_symbol\tassociation_type\tdisease_id\tsource
NCBIGene:1\tARX1\tMENDELIAN\tOMIM:222222\tmock
NCBIGene:2\tADONLY\tMENDELIAN\tOMIM:333333\tmock
NCBIGene:3\tMIXED\tMENDELIAN\tMIM:444444\tmock
NCBIGene:4\tXLR1\tMENDELIAN\tOMIM:888888\tmock
NCBIGene:5\tPOLY\tPOLYGENIC\tOMIM:555555\tmock
NCBIGene:6\tORPHAONLY\tMENDELIAN\tORPHA:999999\tmock`;

const phenotypeText = `database_id\tdisease_name\tqualifier\thpo_id\treference\tevidence\tonset\tfrequency\tsex\tmodifier\taspect\tbiocuration
OMIM:222222\tExample recessive disease\t\tHP:0000007\tOMIM:222222\tTAS\t\t\t\t\tI\tHPO:test
OMIM:333333\tDominant only disease\t\tHP:0000006\tOMIM:333333\tTAS\t\t\t\t\tI\tHPO:test
MIM:444444\tMixed recessive disease\t\tHP:0000007\tOMIM:444444\tTAS\t\t\t\t\tI\tHPO:test
OMIM:444444\tMixed dominant disease\t\tHP:0000006\tOMIM:444444\tTAS\t\t\t\t\tI\tHPO:test
OMIM:888888\tExample X-linked recessive disease\t\tHP:0001419\tOMIM:888888\tTAS\t\t\t\t\tI\tHPO:test
OMIM:555555\tPolygenic recessive disease\t\tHP:0000007\tOMIM:555555\tTAS\t\t\t\t\tI\tHPO:test
ORPHA:999999\tOrphanet-only recessive disease\t\tHP:0000007\tORPHA:999999\tTAS\t\t\t\t\tI\tHPO:test`;

const genePhenotypeText = `ncbi_gene_id\tgene_symbol\thpo_id\thpo_name\tfrequency\tdisease_id
1\tARX1\tHP:0001250\tSeizure\t7/10\tOMIM:222222
1\tARX1\tHP:0001263\tGlobal developmental delay\tHP:0040282\tOMIM:222222
1\tARX1\tHP:0000007\tAutosomal recessive inheritance\t-\tOMIM:222222
3\tMIXED\tHP:0001249\tIntellectual disability\t-\tMIM:444444
4\tXLR1\tHP:0002011\tMorphological central nervous system abnormality\t-\tOMIM:888888
6\tORPHAONLY\tHP:0001250\tSeizure\t-\tORPHA:999999`;

test("detects recessive inheritance strings used by legacy payloads", () => {
  assert.equal(isAutosomalRecessiveInheritance("Autosomal recessive"), true);
  assert.equal(isAutosomalRecessiveInheritance("Autosomal dominant; Autosomal recessive"), true);
  assert.equal(isAutosomalRecessiveInheritance("AR"), true);
  assert.equal(isAutosomalRecessiveInheritance("Autosomal dominant"), false);

  assert.equal(isXLinkedRecessiveInheritance("X-linked recessive"), true);
  assert.equal(isXLinkedRecessiveInheritance("X linked recessive"), true);
  assert.equal(isXLinkedRecessiveInheritance("XLR"), true);
  assert.equal(isXLinkedRecessiveInheritance("X-linked dominant"), false);
  assert.equal(isXLinkedRecessiveInheritance("Autosomal recessive"), false);
});

test("parses HPO gene-disease rows and normalizes MIM identifiers", () => {
  const rows = parseHpoGeneDiseaseRows(geneDiseaseText);
  assert.equal(rows.length, 6);
  assert.equal(rows[2].geneSymbol, "MIXED");
  assert.equal(rows[2].diseaseId, "OMIM:444444");
});

test("parses HPO phenotype rows into inheritance details", () => {
  const details = parseHpoPhenotypeRows(phenotypeText);
  assert.equal(details.get("OMIM:222222").diseaseName, "Example recessive disease");
  assert.equal(details.get("OMIM:222222").inheritanceTerms.has("HP:0000007"), true);
  assert.equal(details.get("OMIM:888888").inheritanceTerms.has("HP:0001419"), true);
});

test("parses HPO gene-phenotype rows and normalizes MIM identifiers", () => {
  const rows = parseHpoGenePhenotypeRows(genePhenotypeText);
  assert.equal(rows.length, 6);
  assert.equal(rows[3].diseaseId, "OMIM:444444");
  assert.equal(rows[0].name, "Seizure");
});

test("filters Ensembl genes to autosomal recessive HPO disease associations", () => {
  const hpo = buildHpoAnnotationIndex(geneDiseaseText, phenotypeText, genePhenotypeText);
  const genes = filterGenesByRecessiveAnnotations(
    [
      { geneSymbol: "ARX1", geneName: "AR example", geneStart: 1200, geneEnd: 4000, region: "chr2:1000-9000000", overlapStatus: "within region" },
      { geneSymbol: "ADONLY", geneName: "AD only", geneStart: 5000, geneEnd: 8000, region: "chr2:1000-9000000", overlapStatus: "within region" },
      { geneSymbol: "MIXED", geneName: "mixed", geneStart: 9000, geneEnd: 12_000, region: "chr2:1000-9000000", overlapStatus: "within region" },
      { geneSymbol: "POLY", geneName: "polygenic", geneStart: 13_000, geneEnd: 16_000, region: "chr2:1000-9000000", overlapStatus: "within region" },
      { geneSymbol: "ORPHAONLY", geneName: "orphanet-only", geneStart: 17_000, geneEnd: 20_000, region: "chr2:1000-9000000", overlapStatus: "within region" }
    ],
    hpo,
    interval
  );

  assert.deepEqual(
    genes.map((gene) => gene.geneSymbol),
    ["ARX1", "MIXED"]
  );
  assert.equal(genes[0].phenotypes[0].phenotypeMimNumber, "222222");
  assert.equal(genes[1].phenotypes[0].inheritance, "Autosomal recessive");
  assert.deepEqual(
    genes[0].phenotypes[0].hpoTerms.map((term) => term.name),
    ["Global developmental delay", "Seizure"]
  );
});

test("filters chrX intervals to X-linked recessive HPO disease associations", () => {
  const hpo = buildHpoAnnotationIndex(geneDiseaseText, phenotypeText, genePhenotypeText);
  const xInterval = { chromosome: "chrX", start: 500, end: 5000 };
  const genes = filterGenesByRecessiveAnnotations(
    [
      { geneSymbol: "ARX1", geneName: "AR example", geneStart: 1200, geneEnd: 4000, region: "chrX:500-5000", overlapStatus: "within region" },
      { geneSymbol: "XLR1", geneName: "X-linked example", geneStart: 1500, geneEnd: 3000, region: "chrX:500-5000", overlapStatus: "within region" }
    ],
    hpo,
    xInterval
  );

  assert.equal(genes.length, 1);
  assert.equal(genes[0].geneSymbol, "XLR1");
  assert.equal(genes[0].phenotypes[0].phenotypeMimNumber, "888888");
  assert.deepEqual(genes[0].phenotypes[0].hpoTerms.map((term) => term.name), ["Morphological central nervous system abnormality"]);
});

test("splits large hg19 intervals for Ensembl GRCh37 overlap limits", () => {
  const chunks = splitIntervalForEnsembl(interval);
  assert.equal(chunks.length, 2);
  assert.deepEqual(chunks[0], { chromosome: "chr2", start: 1000, end: 5_000_999 });
  assert.deepEqual(chunks[1], { chromosome: "chr2", start: 5_001_000, end: 9_000_000 });
});

test("analyzeIntervalsWithPublicAnnotations uses mocked Ensembl and HPO fetches", async () => {
  const fetchImpl = async (input) => {
    const url = String(input);
    if (url.includes("genes_to_disease")) {
      return new Response(geneDiseaseText, { status: 200 });
    }
    if (url.includes("phenotype.hpoa")) {
      return new Response(phenotypeText, { status: 200 });
    }
    if (url.includes("genes_to_phenotype")) {
      return new Response(genePhenotypeText, { status: 200 });
    }
    if (url.includes("grch37.rest.ensembl.org")) {
      return new Response(
        JSON.stringify([
          {
            id: "ENSG000001",
            external_name: "ARX1",
            description: "AR example [Source:HGNC Symbol;Acc:HGNC:1]",
            start: 900,
            end: 2000,
            biotype: "protein_coding"
          },
          {
            id: "ENSG000002",
            external_name: "ADONLY",
            description: "AD only",
            start: 2500,
            end: 4000,
            biotype: "protein_coding"
          }
        ]),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const result = await analyzeIntervalsWithPublicAnnotations([{ chromosome: "chr2", start: 1000, end: 2000 }], { fetchImpl });

  assert.equal(result.source.name, "Ensembl GRCh37 + HPO public annotations");
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].genes.length, 1);
  assert.equal(result.results[0].genes[0].geneSymbol, "ARX1");
  assert.equal(result.results[0].genes[0].overlapStatus, "spans start");
  assert.equal(result.results[0].genes[0].phenotypes[0].hpoTerms.length, 2);
});
