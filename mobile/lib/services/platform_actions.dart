import 'dart:convert';
import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:html/parser.dart' as html;
import 'package:qr_flutter/qr_flutter.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../data/models.dart';
import '../state/user_settings.dart';
import 'ics.dart';

class PlatformActionException implements Exception {
  const PlatformActionException(this.message);
  final String message;
  @override
  String toString() => message;
}

enum _ShareAction { system, link, content, text, qr }

class PlatformActions {
  PlatformActions({required String webBaseUrl}) {
    final uri = _httpUri(webBaseUrl);
    if (uri.scheme != 'https' || uri.hasQuery || uri.hasFragment) {
      throw const PlatformActionException('公开网页地址必须是不含查询参数和片段的 HTTPS 地址');
    }
    _webBase = uri.replace(
      path: uri.path.endsWith('/') ? uri.path : '${uri.path}/',
    );
  }

  late final Uri _webBase;
  static const feedbackEmail = 'cuijunxi@mail.ustc.edu.cn';

  static Uri _httpUri(String value) {
    final uri = Uri.tryParse(value);
    if (uri == null ||
        !uri.hasAuthority ||
        uri.host.isEmpty ||
        uri.userInfo.isNotEmpty ||
        !['http', 'https'].contains(uri.scheme) ||
        RegExp(r'[\s\x00-\x1f\x7f]').hasMatch(value)) {
      throw const PlatformActionException('链接地址无效，仅允许不含账号密码的 HTTP / HTTPS 链接');
    }
    return uri;
  }

  String _noticeUrl(Notice notice) {
    if (!isValidNoticeId(notice.id)) {
      throw const PlatformActionException('通知编号无效，无法分享');
    }
    return _webBase
        .replace(fragment: '/detail/${Uri.encodeComponent(notice.id)}')
        .toString();
  }

  Rect _shareOrigin([Rect? origin]) {
    if (origin != null && origin.width > 0 && origin.height > 0) return origin;
    final view = WidgetsBinding.instance.platformDispatcher.views.first;
    final size = view.physicalSize / view.devicePixelRatio;
    return Rect.fromLTWH(size.width / 2, size.height / 2, 1, 1);
  }

  String shareText(Notice notice) => [
    '【通知】${notice.title}',
    '【摘要】${notice.aiSummary}',
    '【来源】${notice.source}',
    '【发布时间】${publishDateLabel(notice.publishDate)}',
    if (notice.deadline != null) '【截止】${notice.deadline}',
    '',
    '【链接】${_noticeUrl(notice)}',
  ].join('\n');

  Future<void> shareNotice(Notice notice, {Rect? origin}) async {
    try {
      // A dismissed sheet is not an error. Even a successful result only means
      // a destination was selected, not that the recipient received anything.
      await SharePlus.instance.share(
        ShareParams(
          text: shareText(notice),
          subject: notice.title,
          sharePositionOrigin: _shareOrigin(origin),
        ),
      );
    } on PlatformException catch (error) {
      throw PlatformActionException('无法打开系统分享：${error.message ?? error.code}');
    }
  }

  Future<void> showShareOptions(BuildContext context, Notice notice) async {
    final box = context.findRenderObject();
    final origin = box is RenderBox && box.hasSize
        ? box.localToGlobal(Offset.zero) & box.size
        : null;
    final action = await showModalBottomSheet<_ShareAction>(
      context: context,
      useSafeArea: true,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (sheetContext) => SafeArea(
        top: false,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Padding(
                padding: const EdgeInsets.all(16),
                child: Text(
                  '分享通知',
                  style: Theme.of(sheetContext).textTheme.titleLarge,
                ),
              ),
              for (final option in <(_ShareAction, IconData, String)>[
                (_ShareAction.system, Icons.share_outlined, '系统分享'),
                (_ShareAction.link, Icons.link, '复制链接'),
                (_ShareAction.content, Icons.content_copy, '复制通知内容'),
                (_ShareAction.text, Icons.text_snippet_outlined, '复制分享文本'),
                (_ShareAction.qr, Icons.qr_code_2, '显示二维码'),
              ])
                ListTile(
                  leading: Icon(option.$2),
                  title: Text(option.$3),
                  onTap: () => Navigator.pop(sheetContext, option.$1),
                ),
              const SizedBox(height: 16),
            ],
          ),
        ),
      ),
    );
    if (action == null || !context.mounted) return;
    switch (action) {
      case _ShareAction.system:
        await shareNotice(notice, origin: origin);
      case _ShareAction.link:
        await copy(_noticeUrl(notice));
      case _ShareAction.content:
        final content = html.parse(notice.cleanContent).body?.text.trim() ?? '';
        await copy(
          [
            notice.title,
            '',
            notice.aiSummary,
            if (content.isNotEmpty) ...['', content],
            '',
            '来源: ${notice.source}',
            '发布时间: ${publishDateLabel(notice.publishDate)}',
            if (notice.deadline != null) '截止日期: ${notice.deadline}',
          ].join('\n'),
        );
      case _ShareAction.text:
        await copy(shareText(notice));
      case _ShareAction.qr:
        final url = _noticeUrl(notice);
        await showDialog<void>(
          context: context,
          builder: (dialogContext) => AlertDialog(
            title: const Text('扫描二维码查看通知'),
            content: SingleChildScrollView(
              child: SizedBox(
                width: 280,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(notice.title),
                    const SizedBox(height: 16),
                    Semantics(
                      label: '通知网页二维码，下方提供可选择的完整链接',
                      image: true,
                      child: ColoredBox(
                        color: Colors.white,
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: QrImageView(
                            data: url,
                            size: 220,
                            backgroundColor: Colors.white,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),
                    SelectableText(url),
                  ],
                ),
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(dialogContext),
                child: const Text('关闭'),
              ),
            ],
          ),
        );
    }
    if (context.mounted &&
        action != _ShareAction.system &&
        action != _ShareAction.qr) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('已复制到剪贴板')));
    }
  }

  Future<void> openUrl(String value, {bool trusted = false}) async {
    final uri = _httpUri(value);
    if (trusted && (uri.scheme != 'https' || !isTrustedNoticeHost(uri.host))) {
      throw const PlatformActionException('原文链接必须来自中国科学技术大学或 LUG 的 HTTPS 网站');
    }
    // External applications only: attachments never execute inside our app,
    // and arbitrary custom schemes / credentials are never forwarded.
    if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
      throw const PlatformActionException('无法打开链接，请检查是否安装了可用的浏览器或阅读器');
    }
  }

  Future<void> copy(String text) async {
    try {
      await Clipboard.setData(ClipboardData(text: text));
    } on PlatformException catch (error) {
      throw PlatformActionException('复制失败：${error.message ?? error.code}');
    }
  }

  Future<void> exportPreferences(UserSettings settings) async {
    final bytes = Uint8List.fromList(utf8.encode(settings.exportBackup()));
    if (bytes.length > maxPreferenceBytes) {
      throw const PlatformActionException('偏好文件不能超过 5 MiB');
    }
    await FilePicker.saveFile(
      fileName: 'notifai-settings-${dateOnly(DateTime.now())}.json',
      bytes: bytes,
      mimeType: 'application/json',
      dialogTitle: '导出偏好设置',
    );
  }

  Future<void> importPreferences(UserSettings settings) async {
    final file = await FilePicker.pickFile(
      dialogTitle: '导入 NotifAI 偏好设置',
      type: FileType.custom,
      allowedExtensions: const ['json'],
    );
    if (file == null) return;
    final knownLength = file.lengthSync();
    if (knownLength != null && knownLength > maxPreferenceBytes) {
      throw const PlatformActionException('偏好文件不能超过 5 MiB');
    }
    final bytes = BytesBuilder(copy: false);
    await for (final chunk in file.readAsByteStream()) {
      if (bytes.length + chunk.length > maxPreferenceBytes) {
        throw const PlatformActionException('偏好文件不能超过 5 MiB');
      }
      bytes.add(chunk);
    }
    if (bytes.isEmpty) throw const PlatformActionException('偏好文件为空');
    String json;
    try {
      json = utf8.decode(bytes.takeBytes(), allowMalformed: false);
    } on FormatException {
      throw const PlatformActionException('偏好文件必须为有效的 UTF-8 编码');
    }
    if (json.startsWith('\uFEFF')) json = json.substring(1);
    await settings.importBackup(json);
  }

  Future<void> exportCalendar(
    List<CalendarEntry> entries, {
    required String rangeStart,
    required String rangeEnd,
  }) async {
    final content = buildCalendarIcs(
      entries,
      rangeStart: rangeStart,
      rangeEnd: rangeEnd,
    );
    await FilePicker.saveFile(
      fileName: 'notifai-calendar-$rangeStart.ics',
      bytes: Uint8List.fromList(utf8.encode(content)),
      mimeType: 'text/calendar',
      dialogTitle: '导出当前范围日历',
    );
  }

  Future<void> feedback() async {
    if (!await launchUrl(
      Uri(
        scheme: 'mailto',
        path: feedbackEmail,
        queryParameters: const {'subject': 'NotifAI 意见反馈'},
      ),
      mode: LaunchMode.externalApplication,
    )) {
      throw const PlatformActionException('未找到邮件应用，请发送邮件至 $feedbackEmail');
    }
  }
}
