# ROH-to-OMIM Recessive Gene Finder

A free-hostable clinical utility for pasted chromosome microarray report excerpts. It extracts hg19 regions of homozygosity, sends only normalized chromosome 1-22/X intervals to a serverless API route, and returns disease genes whose HPO inheritance annotations match the interval: autosomal recessive for chromosomes 1-22 and X-linked recessive for `chrX`.


## Important Notes

- Input coordinates are treated as GRCh37/hg19.
- Chromosomes `chr1` through `chr22` and `chrX` are analyzed.
- Copy-number events and report lines such as `arr[hg19] ... x1` are ignored by the parser.
