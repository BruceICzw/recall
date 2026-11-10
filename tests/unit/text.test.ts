import { describe, expect, it } from 'vitest';
import { cleanInline, cleanText } from '../../modules/text/clean';
import { chunkText, metaChunkText, splitSentences } from '../../modules/text/chunk';
import { editDistance, queryTokens, stem, tokenize } from '../../modules/text/tokenize';

const para = (n: number, word = 'alpha') =>
  Array.from({ length: n }, (_, i) => `Sentence number ${i} talks about ${word} topics in some detail.`).join(' ');

describe('cleanText', () => {
  it('normalises whitespace and keeps paragraphs', () => {
    const out = cleanText('Hello   world.\n\n\n  Second\tparagraph  here. \r\n');
    expect(out).toBe('Hello world.\n\nSecond paragraph here.');
  });
  it('drops boilerplate and duplicate lines', () => {
    const out = cleanText(
      'Accept all cookies\nThe real article content starts here and continues.\n\nThe real article content starts here and continues.\nSkip to content',
    );
    expect(out).toBe('The real article content starts here and continues.');
  });
  it('caps length', () => {
    expect(cleanText(para(5000), 1000).length).toBeLessThanOrEqual(1000);
  });
  it('cleanInline trims and truncates', () => {
    expect(cleanInline('  a \n b  ')).toBe('a b');
    expect(cleanInline('x'.repeat(20), 10)).toBe('xxxxxxxxxx…');
    expect(cleanInline(undefined)).toBe('');
  });
});

describe('chunking', () => {
  it('splits sentences without breaking abbreviations', () => {
    const s = splitSentences('Dr. Moyo built it, e.g. for schools. It works well! Does it scale? Yes.');
    expect(s).toEqual(['Dr. Moyo built it, e.g. for schools.', 'It works well!', 'Does it scale?', 'Yes.']);
  });
  it('produces bounded chunks covering the text', () => {
    const text = [para(20), para(20, 'beta'), para(20, 'gamma')].join('\n\n');
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1000 + 130);
    expect(chunks.some((c) => c.includes('beta'))).toBe(true);
    expect(chunks.some((c) => c.includes('gamma'))).toBe(true);
    // last sentence is present
    expect(chunks[chunks.length - 1]).toContain('Sentence number 19 talks about gamma');
  });
  it('overlaps consecutive chunks', () => {
    const chunks = chunkText(para(40), { overlapChars: 80 });
    const tail = chunks[0].slice(-40);
    expect(chunks[1].includes(tail.slice(tail.indexOf(' ') + 1))).toBe(true);
  });
  it('splits a single giant sentence', () => {
    const chunks = chunkText('word '.repeat(1000));
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1000 + 130);
  });
  it('caps chunks per page', () => {
    expect(chunkText(para(2000), { maxChunks: 5 }).length).toBe(5);
  });
  it('returns nothing for empty text', () => {
    expect(chunkText('')).toEqual([]);
  });
  it('meta chunk includes title, description and readable URL path', () => {
    const m = metaChunkText('PM2 guide', 'Deploy Next.js', 'https://www.example.com/blog/deploy-nextjs-with-pm2.html');
    expect(m).toContain('PM2 guide');
    expect(m).toContain('example.com blog deploy nextjs with pm2');
  });
});

describe('tokenize', () => {
  it('lowercases, strips accents, stems plurals', () => {
    expect(tokenize('Écoles, Databases & APIs!')).toEqual(['ecole', 'database', 'api']);
    expect(stem('libraries')).toBe('library');
    expect(stem('class')).toBe('class');
  });
  it('removes memory-search filler from queries', () => {
    expect(queryTokens('Find that AI tutor website I visited in Zimbabwe')).toEqual(['ai', 'tutor', 'zimbabwe']);
  });
  it('bounded edit distance', () => {
    expect(editDistance('zimbabwe', 'zimbabwe')).toBe(0);
    expect(editDistance('zimbabwe', 'zimbabew')).toBe(2);
    expect(editDistance('vector', 'vectro', 1)).toBe(2);
    expect(editDistance('postgres', 'postgress')).toBe(1);
  });
});
