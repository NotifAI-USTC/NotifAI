import 'package:flutter_test/flutter_test.dart';
import 'package:html/dom.dart' as dom;
import 'package:html/parser.dart' as html;
import 'package:notifai_mobile/app.dart' show defaultWebBase;
import 'package:notifai_mobile/services/notice_content.dart';
import 'package:notifai_mobile/services/notice_link.dart';

void main() {
  const origin = 'https://www.teach.ustc.edu.cn/notices/one.html';
  test('超深正文在交给渲染器前裁剪，其他段落仍可阅读', () {
    final result = sanitizeNoticeContent(
      '<div><p>正常段落</p>${List.filled(1000, '<span>').join()}深层文字${List.filled(1000, '</span>').join()}</div>',
      origin,
    );
    final document = html.parseFragment(result.html);
    expect(document.querySelector('p')?.text, '正常段落');
    expect(result.limited, isTrue);
    final pending = <(dom.Node, int)>[(document, 0)];
    while (pending.isNotEmpty) {
      final (node, depth) = pending.removeLast();
      expect(depth, lessThanOrEqualTo(65));
      for (final child in node.nodes) {
        pending.add((child, depth + 1));
      }
    }
  });
  test('混合正文保留结构，丢弃活动内容与危险资源', () {
    final result = sanitizeNoticeContent(
      '''<div><h2>报名安排</h2><p onclick="bad()" style="color:red">请申请 <strong>奖学金</strong></p><iframe src="https://evil.test"></iframe><script>bad()</script><svg><a href="javascript:bad()">坏链接</a></svg><table><tr><td colspan="2" onmouseover="bad()">材料</td></tr></table><a href="javascript:bad()">下载</a><a href="../files/form.pdf" ping="https://evil.test">表格</a><img src="https://evil.test/pixel"><img src="../photo.png" onerror="bad()"><img src="file:///etc/passwd"></div>''',
      origin,
    );
    final document = html.parseFragment(result.html);
    expect(document.querySelector('h2')?.text, '报名安排');
    expect(document.querySelector('strong')?.text, '奖学金');
    expect(document.querySelector('td')?.text, '材料');
    expect(document.querySelectorAll('script,iframe,svg,form'), isEmpty);
    expect(
      document.querySelectorAll('[onclick],[style],[onerror],[ping]'),
      isEmpty,
    );
    expect(
      document.querySelectorAll('a[href]').map((a) => a.attributes['href']),
      ['https://www.teach.ustc.edu.cn/files/form.pdf'],
    );
    expect(result.images, ['https://www.teach.ustc.edu.cn/photo.png']);
    expect(document.querySelectorAll('img'), hasLength(1));
  });
  test('Markdown表格与内联HTML共存，图片必须先通过可信来源校验', () {
    final result = sanitizeNoticeContent(
      '''# 通知\n\n这是 **重要** 信息与 <em>原文</em>。\n\n| 项目 | 日期 |\n| --- | --- |\n| 报名 | 明天 |\n\n![学校](https://ustc.edu.cn/a.png) ![伪装](https://ustc.edu.cn.evil.test/a.png)''',
      origin,
    );
    final document = html.parseFragment(result.html);
    expect(document.querySelector('h1')?.text, '通知');
    expect(document.querySelector('table')?.text, contains('报名'));
    expect(document.querySelector('em')?.text, '原文');
    expect(result.images, ['https://ustc.edu.cn/a.png']);
    expect(
      safeHttpUri('https://user@ustc.edu.cn/a.png', trusted: true),
      isNull,
    );
    expect(safeHttpUri('data:image/png;base64,AA==', trusted: true), isNull);
  });
  test('仅接受受信域名及有效通知ID的外部入口', () {
    const web = defaultWebBase;
    expect(
      noticeIdFromUri(Uri.parse('notifai://detail/abc_123'), webBaseUrl: web),
      'abc_123',
    );
    expect(
      noticeIdFromUri(Uri.parse('$web/#/detail/abc_123'), webBaseUrl: web),
      'abc_123',
    );
    expect(
      noticeIdFromUri(Uri.parse('$web/n/abc_123'), webBaseUrl: web),
      'abc_123',
    );
    for (final link in [
      'https://evil.test/#/detail/abc',
      'notifai://detail/abc/def',
      'notifai://detail/%2Fetc',
      'https://user@notifai.top/#/detail/abc',
      'https://notifai.enthusjast.cc/#/detail/abc',
    ]) {
      expect(noticeIdFromUri(Uri.parse(link), webBaseUrl: web), isNull);
    }
  });
}
