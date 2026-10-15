import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('function parseWordList('),end=html.indexOf('// End of list parser.',start);
assert.ok(start>=0&&end>start);
const context={};vm.runInNewContext(html.slice(start,end),context);
const parse=text=>JSON.parse(JSON.stringify(context.parseWordList(text)));

test('user examples and arbitrary punctuation separators',()=>{
  const result=parse('add - добавлять\nnurse _ медсестра\nlook after → присматривать\ngive up => сдаваться\nhelp 🤝 помогать');
  assert.deepEqual(result,{entries:[{en:'add',ru:'добавлять'},{en:'nurse',ru:'медсестра'},{en:'look after',ru:'присматривать'},{en:'give up',ru:'сдаваться'},{en:'help',ru:'помогать'}],errors:[]});
});
test('handles blank lines, CRLF, tabs and extra whitespace',()=>{
  assert.deepEqual(parse('\ufeff add  \t-\t добавлять \r\n\r\n  nurse _ медсестра  \r').entries,[{en:'add',ru:'добавлять'},{en:'nurse',ru:'медсестра'}]);
});
test('phrases, hyphenated words and translation punctuation are preserved',()=>{
  assert.deepEqual(parse("mother-in-law : свекровь / тёща\ntake  care — заботиться - ухаживать").entries,[{en:'mother-in-law',ru:'свекровь / тёща'},{en:'take care',ru:'заботиться - ухаживать'}]);
});
test('invalid lines retain their original line numbers',()=>{
  const result=parse('add - добавлять\n\ninvalid\nnurse_медсестра\nword - ');
  assert.equal(result.entries.length,1);assert.equal(result.errors.length,3);
  assert.match(result.errors[0],/Строка 3/);assert.match(result.errors[1],/Строка 4/);assert.match(result.errors[2],/Строка 5/);
});
test('empty input and oversized fields are rejected',()=>{
  assert.equal(parse(' \n\t').errors.length,1);
  assert.equal(parse('a'.repeat(81)+' - слово').errors.length,1);
  assert.equal(parse('word - '+'я'.repeat(121)).errors.length,1);
  assert.equal(parse('a'.repeat(80)+' - '+'я'.repeat(120)).errors.length,0);
});
test('limits list size to 500 pairs',()=>{
  assert.equal(parse(Array(500).fill('word - слово').join('\n')).errors.length,0);
  assert.equal(parse(Array(501).fill('word - слово').join('\n')).errors.length,1);
});
