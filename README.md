# ROH-to-OMIM Recessive Gene Finder

A free-hostable clinical utility for pasted chromosome microarray report excerpts. It extracts hg19 regions of homozygosity, sends only normalized chromosome 1-22/X intervals to a serverless API route, and returns disease genes whose HPO inheritance annotations match the interval: autosomal recessive for chromosomes 1-22 and X-linked recessive for `chrX`.

The backend does not require an OMIM API key. It uses Ensembl GRCh37 for gene overlap and public Human Phenotype Ontology annotation files for disease-gene, inheritance, and HPO phenotype-term filtering, keeping only disease associations with OMIM/MIM identifiers.

## Local Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

## Vercel Deployment

1. Push the project to GitHub.
2. Import the repo into Vercel on the Hobby plan.
3. Deploy. No server-side API key is required for the default public annotation sources.

Browser code sends only parsed intervals such as `chr2:204991426-224932239`; it does not send raw pasted report text.

## Important Notes

- Input coordinates are treated as GRCh37/hg19.
- Chromosomes `chr1` through `chr22` and `chrX` are analyzed.
- Copy-number events and report lines such as `arr[hg19] ... x1` are ignored by the parser.
- Results are decision support. Verify ROH coordinates, disease mappings, and inheritance clinically before using them in patient care.
- For public, institutional, or commercial use, review the terms for HPO annotations and OMIM-derived disease content.

## Tests

```bash
npm test
```

The tests cover ROH parsing, malformed interval handling, Ensembl interval chunking, and HPO annotation/phenotype-term filtering with mocked payloads.
