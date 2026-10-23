"""Read-only manuscript comparison. Never opens either database for writing."""
import argparse
import difflib
import hashlib
import html
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


def digest(text):
    return hashlib.sha256((text or '').encode('utf-8')).hexdigest()


def snapshot(database, novel_id):
    with sqlite3.connect(database.resolve().as_uri() + '?mode=ro', uri=True) as db:
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA query_only=ON')
        db.execute('BEGIN')
        novel = dict(db.execute('SELECT id,title,context_version,updated_at FROM novels WHERE id=?', (novel_id,)).fetchone())
        chapters = [dict(r) for r in db.execute('SELECT id,chapter_num,title,content,summary,updated_at FROM chapters WHERE novel_id=? ORDER BY chapter_num', (novel_id,))]
        artifacts = [dict(r) for r in db.execute("SELECT id,kind,status,version,content_json,content_hash,task_id,created_at,updated_at FROM artifacts WHERE novel_id=? AND kind='generic_draft' ORDER BY created_at", (novel_id,))]
    return dict(novel=novel, chapters=chapters, artifacts=artifacts)


def prose_candidates(value):
    if isinstance(value, dict):
        if isinstance(value.get('content'), str) and value.get('chapterNum') is not None:
            yield value
        for child in value.values():
            yield from prose_candidates(child)
    elif isinstance(value, str) and value.lstrip().startswith(('{', '[', '```')):
        try:
            raw = value.strip()
            if raw.startswith('```'):
                raw = raw.split('\n', 1)[1].rsplit('```', 1)[0].strip()
            yield from prose_candidates(json.loads(raw))
        except (ValueError, IndexError):
            pass
    elif isinstance(value, list):
        for child in value:
            yield from prose_candidates(child)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('formal', type=Path)
    parser.add_argument('test', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--novel-id', type=int, default=292)
    args = parser.parse_args()
    formal, test = snapshot(args.formal, args.novel_id), snapshot(args.test, args.novel_id)
    args.output.mkdir(parents=True, exist_ok=True)
    report = {'capturedAt': datetime.now(timezone.utc).isoformat(), 'readOnly': True,
              'formalPath': str(args.formal), 'testPath': str(args.test),
              'formalNovel': formal['novel'], 'testNovel': test['novel'], 'chapters': [], 'newCandidates': []}
    formal_by_num = {c['chapter_num']: c for c in formal['chapters']}
    test_by_num = {c['chapter_num']: c for c in test['chapters']}
    sections = []
    for num in sorted(formal_by_num.keys() | test_by_num.keys()):
        left, right = formal_by_num.get(num, {}), test_by_num.get(num, {})
        old, new = left.get('content') or '', right.get('content') or ''
        changed = [key for key in ['title', 'content', 'summary'] if (left.get(key) or '') != (right.get(key) or '')]
        row = {'chapter': num, 'title': right.get('title', left.get('title')), 'changedFields': changed,
               'formalChars': len(old), 'testChars': len(new), 'formalHash': digest(old), 'testHash': digest(new),
               'formalUpdatedAt': left.get('updated_at'), 'testUpdatedAt': right.get('updated_at')}
        report['chapters'].append(row)
        if not changed:
            continue
        diff = ''.join(difflib.unified_diff(old.splitlines(True), new.splitlines(True), fromfile='正式稿', tofile='测试库当前正文'))
        (args.output / f'chapter-{num}.diff').write_text(diff, encoding='utf-8')
        table = difflib.HtmlDiff(wrapcolumn=65).make_table(old.splitlines(), new.splitlines(), '正式稿', '测试库当前正文', context=True, numlines=2)
        sections.append(f'<details><summary>第 {num} 章 · {html.escape(row["title"] or "")} · {len(old)} → {len(new)} 字符</summary>{table}</details>')
        if 'summary' in changed:
            sections.append(f'<details><summary>第 {num} 章摘要差异</summary><pre>{html.escape(left.get("summary") or "")}</pre><hr><pre>{html.escape(right.get("summary") or "")}</pre></details>')
    known = {a['id']: a['content_hash'] for a in formal['artifacts']}
    for artifact in test['artifacts']:
        if known.get(artifact['id']) == artifact['content_hash']:
            continue
        try:
            candidates = list(prose_candidates(json.loads(artifact['content_json'])))
        except (ValueError, TypeError):
            continue
        for candidate in candidates:
            content = candidate['content']
            num = candidate['chapterNum']
            base = (formal_by_num.get(num) or {}).get('content') or ''
            row = {key: artifact[key] for key in ['id', 'status', 'task_id', 'created_at']}
            row.update(chapter=num, chars=len(content), hash=digest(content), sameAsFormal=content == base)
            report['newCandidates'].append(row)
            if content != base:
                filename = f'candidate-{artifact["id"]}-chapter-{num}.diff'
                (args.output / filename).write_text(''.join(difflib.unified_diff(base.splitlines(True), content.splitlines(True), fromfile='正式稿', tofile=f'测试候选 {artifact["id"]}')), encoding='utf-8')
                row['diffFile'] = filename
    (args.output / 'comparison.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    # Snapshots make the comparison reproducible even if another session later changes the test copy.
    for name, data in [('formal', formal), ('test', test)]:
        (args.output / f'{name}-chapters.json').write_text(json.dumps(data['chapters'], ensure_ascii=False, indent=2), encoding='utf-8')
    rows = ''.join(f'<tr><td>{r["chapter"]}</td><td>{html.escape(r["title"] or "")}</td><td>{r["formalChars"]}</td><td>{r["testChars"]}</td><td>{html.escape(", ".join(r["changedFields"]) or "正文与摘要相同")}</td></tr>' for r in report['chapters'])
    candidate_rows = ''.join(f'<tr><td>{r["chapter"]}</td><td>{html.escape(r["created_at"] or "")}</td><td>{r["status"]}</td><td>{r["chars"]}</td><td>{r["task_id"]}</td><td><a href="{r.get("diffFile", "#")}">{html.escape(r["id"])}</a></td></tr>' for r in reversed(report['newCandidates']))
    page = f'''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>正式库与测试库稿件差异</title>
<style>body{{font:15px/1.7 system-ui;margin:32px;color:#25332f}}h1{{font-size:26px}}table{{border-collapse:collapse;width:100%;margin:18px 0}}td,th{{border:1px solid #ddd;padding:7px;text-align:left}}.diff{{font:12px/1.6 monospace}}.diff_add{{background:#d8f0dd}}.diff_sub{{background:#f8d9d9}}.diff_chg{{background:#fff0b8}}details{{margin:20px 0;overflow:auto}}summary{{cursor:pointer;font-weight:600}}pre{{white-space:pre-wrap}}.note{{padding:16px;background:#fff0cb}}</style>
<h1>《{html.escape(formal['novel']['title'])}》稿件差异</h1><p class="note">只读比较，没有应用候选、覆盖正文或合并数据库。字符数包含标点和空白。候选状态属于测试库流程记录，不代表已获作者接受。</p>
<p>正式库上下文版本：{formal['novel']['context_version']}；测试库：{test['novel']['context_version']}。快照：{report['capturedAt']}</p>
<p>正式库：{html.escape(str(args.formal))}<br>测试库：{html.escape(str(args.test))}</p>
<table><tr><th>章</th><th>标题</th><th>正式字符数</th><th>测试字符数</th><th>差异字段</th></tr>{rows}</table>
{''.join(sections)}<h2>测试库独有或内容不同的正文候选（{len(report['newCandidates'])} 份）</h2><p>按时间倒序；展开上述章节查看当前正文差异，候选编号链接为逐行差异文件。</p>
<table><tr><th>章</th><th>创建时间（原始记录）</th><th>状态</th><th>字符数</th><th>任务</th><th>候选</th></tr>{candidate_rows}</table></html>'''
    (args.output / 'comparison.html').write_text(page, encoding='utf-8')
    print(json.dumps({'chapters': report['chapters'], 'newCandidates': len(report['newCandidates']), 'output': str(args.output)}, ensure_ascii=True))


if __name__ == '__main__':
    main()
