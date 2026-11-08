import 'package:html/dom.dart' as dom;
import 'package:html/parser.dart' as html;
import 'package:markdown/markdown.dart' as markdown;

import '../data/models.dart';

class NoticeContent {
  const NoticeContent(this.html, this.images, {this.limited = false});
  final String html;
  final List<String> images;
  final bool limited;
}

Uri? safeHttpUri(String value, {Uri? base, bool trusted = false}) {
  if (value.isEmpty ||
      value.length > 4096 ||
      RegExp(r'[\x00-\x1f\x7f]').hasMatch(value)) {
    return null;
  }
  if (RegExp(
    r'^(?:[a-z][a-z0-9+.-]*:)?//[^/?#]*@',
    caseSensitive: false,
  ).hasMatch(value.trim())) {
    return null;
  }
  final candidate = Uri.tryParse(value.trim());
  if (candidate == null) return null;
  final uri = base == null ? candidate : base.resolveUri(candidate);
  if (!{'https', 'http'}.contains(uri.scheme) ||
      uri.host.isEmpty ||
      uri.userInfo.isNotEmpty) {
    return null;
  }
  if (trusted && (uri.scheme != 'https' || !isTrustedNoticeHost(uri.host))) {
    return null;
  }
  return uri;
}

NoticeContent sanitizeNoticeContent(String content, String originUrl) {
  if (content.length > 500000) throw const FormatException('通知正文超过安全大小限制');
  final base = originUrl.isEmpty ? null : safeHttpUri(originUrl, trusted: true);
  final looksHtml = RegExp(
    r'^\s*</?(?:h[1-6]|p|div|table|ul|ol|li|blockquote|section|article|pre|style|iframe|form|svg|a|img)\b',
    caseSensitive: false,
  ).hasMatch(content);
  final rendered = looksHtml
      ? content
      : markdown.markdownToHtml(
          content,
          extensionSet: markdown.ExtensionSet.gitHubFlavored,
        );
  final document = html.parseFragment(rendered);
  const allowed = {
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'p',
    'div',
    'span',
    'section',
    'article',
    'br',
    'hr',
    'strong',
    'b',
    'em',
    'i',
    'u',
    's',
    'del',
    'sub',
    'sup',
    'blockquote',
    'pre',
    'code',
    'ul',
    'ol',
    'li',
    'table',
    'thead',
    'tbody',
    'tfoot',
    'tr',
    'th',
    'td',
    'caption',
    'a',
    'img',
    'dl',
    'dt',
    'dd',
  };
  const discard = {
    'script',
    'style',
    'iframe',
    'object',
    'embed',
    'form',
    'input',
    'button',
    'textarea',
    'select',
    'option',
    'video',
    'audio',
    'source',
    'track',
    'base',
    'link',
    'meta',
    'svg',
    'math',
    'template',
  };
  final images = <String>[];
  var visited = 0;
  var limited = false;
  void clean(dom.Node parent, int depth) {
    for (final node in parent.nodes.toList()) {
      if (node is dom.Comment) {
        node.remove();
        continue;
      }
      if (node is! dom.Element) continue;
      if (depth >= 64 || ++visited > 10000) {
        limited = true;
        node.remove();
        continue;
      }
      final tag = node.localName;
      if (discard.contains(tag)) {
        node.remove();
        continue;
      }
      clean(node, depth + 1);
      if (!allowed.contains(tag)) {
        node.replaceWith(
          dom.DocumentFragment()..nodes.addAll(node.nodes.toList()),
        );
        continue;
      }
      final old = Map<String, String>.from(
        node.attributes.map((key, value) => MapEntry(key.toString(), value)),
      );
      node.attributes.clear();
      final title = old['title'];
      if (title != null) {
        node.attributes['title'] = title.substring(
          0,
          title.length.clamp(0, 500),
        );
      }
      if (tag == 'a') {
        final uri = safeHttpUri(old['href'] ?? '', base: base);
        if (uri != null) node.attributes['href'] = uri.toString();
      } else if (tag == 'img') {
        final uri = safeHttpUri(old['src'] ?? '', base: base, trusted: true);
        if (uri == null || images.length >= 50) {
          node.remove();
          continue;
        }
        node.attributes['src'] = uri.toString();
        node.attributes['alt'] = (old['alt'] ?? '通知图片').substring(
          0,
          (old['alt'] ?? '通知图片').length.clamp(0, 500),
        );
        images.add(uri.toString());
      } else if (tag == 'td' || tag == 'th') {
        for (final attribute in ['colspan', 'rowspan']) {
          final count = int.tryParse(old[attribute] ?? '');
          if (count != null && count >= 1 && count <= 20) {
            node.attributes[attribute] = '$count';
          }
        }
      }
    }
  }

  clean(document, 0);
  return NoticeContent(
    document.outerHtml,
    List.unmodifiable(images),
    limited: limited,
  );
}
