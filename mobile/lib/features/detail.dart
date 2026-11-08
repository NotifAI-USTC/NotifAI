import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_widget_from_html_core/flutter_widget_from_html_core.dart';

import '../app.dart';
import '../data/models.dart';
import '../services/notice_content.dart';
import '../ui/common.dart';

class DetailScreen extends StatefulWidget {
  const DetailScreen({super.key, required this.services, required this.id});
  final AppServices services;
  final String id;
  @override
  State<DetailScreen> createState() => _DetailScreenState();
}

class _DetailScreenState extends State<DetailScreen> {
  Notice? _notice;
  NoticeContent? _content;
  String? _error, _cacheMessage;
  bool _loading = true;
  int _generation = 0;

  @override
  void initState() {
    super.initState();
    widget.services.reminders.addListener(_remindersChanged);
    unawaited(_load());
  }

  @override
  void didUpdateWidget(DetailScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.id != oldWidget.id) {
      _notice = null;
      _content = null;
      unawaited(_load());
    }
  }

  @override
  void dispose() {
    _generation++;
    widget.services.reminders.removeListener(_remindersChanged);
    super.dispose();
  }

  void _remindersChanged() {
    if (mounted) setState(() {});
  }

  void _show(Notice notice) {
    final content = sanitizeNoticeContent(
      notice.cleanContent,
      notice.originUrl,
    );
    _notice = notice;
    _content = content;
    if (!widget.services.settings.readOnly &&
        !widget.services.settings.value.readIds.contains(notice.id)) {
      unawaited(
        perform(context, () => widget.services.settings.markRead(notice.id)),
      );
    }
  }

  Future<void> _load() async {
    final sequence = ++_generation;
    setState(() {
      _loading = true;
      _error = null;
    });
    if (!isValidNoticeId(widget.id)) {
      setState(() {
        _loading = false;
        _error = '通知 ID 格式无效';
      });
      return;
    }
    try {
      if (_notice == null) {
        try {
          final cached = await widget.services.repository.cachedDetail(
            widget.id,
          );
          if (!mounted || sequence != _generation) return;
          if (cached != null) {
            setState(() {
              _show(cached.value);
              _cacheMessage =
                  '${cached.stale ? '较旧的' : '本地'}详情缓存 · ${cached.savedAt.toLocal().toString().substring(0, 16)}';
            });
          }
        } catch (error) {
          if (!mounted || sequence != _generation) return;
          setState(() => _cacheMessage = '本地详情缓存不可用，正在从网络重新获取：$error');
        }
      }
      final notice = await widget.services.repository.detail(widget.id);
      if (!mounted || sequence != _generation) return;
      setState(() {
        _show(notice);
        _cacheMessage = widget.services.repository.cacheWarning;
      });
      unawaited(widget.services.reminders.reconcile());
    } catch (e) {
      if (mounted && sequence == _generation) {
        setState(
          () => _error = '加载通知详情失败：$e${_notice != null ? '；当前显示缓存数据。' : ''}',
        );
      }
    } finally {
      if (mounted && sequence == _generation) setState(() => _loading = false);
    }
  }

  Future<void> _remind(Notice notice) async {
    if (notice.deadline == null) return;
    final services = widget.services;
    final now = DateTime.now();
    final deadline = parseDateOnly(notice.deadline!);
    final limit = DateTime(deadline.year, deadline.month, deadline.day, 23, 59);
    if (!limit.isAfter(now)) {
      showMessage(context, '此通知的截止日期已过，无法安排提醒。', error: true);
      return;
    }
    final sixtyDays = now.add(const Duration(days: 60));
    final end = limit.isBefore(sixtyDays) ? limit : sixtyDays;
    final suggested = deadline.subtract(const Duration(days: 1));
    final initial = suggested.isBefore(now)
        ? now
        : suggested.isAfter(end)
        ? end
        : suggested;
    final date = await showDatePicker(
      context: context,
      firstDate: DateTime(now.year, now.month, now.day),
      lastDate: DateTime(end.year, end.month, end.day),
      initialDate: DateTime(initial.year, initial.month, initial.day),
      helpText: '选择提醒日期（近期 60 天内）',
    );
    if (date == null || !mounted) return;
    final time = await showTimePicker(
      context: context,
      initialTime: const TimeOfDay(hour: 9, minute: 0),
      helpText: '选择提醒时间',
    );
    if (time == null || !mounted) return;
    final when = DateTime(
      date.year,
      date.month,
      date.day,
      time.hour,
      time.minute,
    );
    if (!when.isAfter(DateTime.now()) || when.isAfter(end)) {
      showMessage(context, '提醒时间须在未来、60 天内且不晚于截止日期。', error: true);
      return;
    }
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('安排本地提醒'),
        content: Text(
          '将在 ${dateOnly(when)} ${time.format(context)}（设备当前时区）提醒，并将此通知标为重要。\n\n截止字段仅包含日期，不代表精确截止时刻。系统省电和通知权限可能影响提醒；这不是新通知后台推送。',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('确认提醒'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    await perform(context, () async {
      final granted = await services.reminders.requestPermission();
      if (!granted) throw StateError(services.reminders.error ?? '系统通知权限未获准');
      await services.settings.update(
        services.settings.value.copyWith(notificationEnabled: true),
      );
      if (!services.settings.value.importantIds.contains(notice.id)) {
        await services.settings.toggleImportant(notice.id);
      }
      await services.reminders.schedule(notice, when);
      if (mounted) {
        setState(() {});
        showMessage(context, '本地提醒已安排');
      }
    });
  }

  Future<void> _preview(String url, String? alt) async {
    if (safeHttpUri(url, trusted: true) == null) return;
    await Navigator.push<void>(
      context,
      MaterialPageRoute(
        builder: (context) => Scaffold(
          appBar: AppBar(title: Text(alt?.isNotEmpty == true ? alt! : '通知图片')),
          body: SafeArea(
            child: InteractiveViewer(
              minScale: .5,
              maxScale: 5,
              child: Center(
                child: Image.network(
                  url,
                  semanticLabel: alt ?? '通知图片',
                  errorBuilder: (_, error, stackTrace) => const EmptyNotice(
                    icon: Icons.broken_image_outlined,
                    title: '图片加载失败',
                    message: '请检查网络，或前往来源页面查看。',
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const Text('通知详情'),
      actions: [
        if (_notice != null)
          IconButton(
            tooltip: '分享通知',
            icon: const Icon(Icons.ios_share),
            onPressed: () => perform(
              context,
              () => widget.services.actions.showShareOptions(context, _notice!),
            ),
          ),
        IconButton(
          tooltip: '刷新详情',
          icon: const Icon(Icons.refresh),
          onPressed: _loading ? null : _load,
        ),
      ],
    ),
    body: SafeArea(
      top: false,
      child: Align(
        alignment: Alignment.topCenter,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 840),
          child: RefreshIndicator(
            onRefresh: _load,
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
              children: [
                if (_loading)
                  const LinearProgressIndicator(semanticsLabel: '正在同步详情'),
                if (_error != null)
                  ErrorNotice(message: _error!, onRetry: _load),
                if (_cacheMessage != null)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    child: Text(_cacheMessage!),
                  ),
                if (_notice != null) ..._body(context, _notice!),
                if (!_loading && _notice == null && _error == null)
                  const EmptyNotice(
                    icon: Icons.find_in_page_outlined,
                    title: '通知不存在',
                  ),
              ],
            ),
          ),
        ),
      ),
    ),
  );
  List<Widget> _body(BuildContext context, Notice notice) {
    final theme = Theme.of(context);
    return [
      const SizedBox(height: 12),
      SelectableText(
        notice.title,
        style: theme.textTheme.headlineSmall?.copyWith(
          fontWeight: FontWeight.w700,
          height: 1.4,
        ),
      ),
      const SizedBox(height: 12),
      Text(
        '${normalizeSource(notice.source)} · ${publishDateLabel(notice.publishDate)}',
        style: theme.textTheme.bodyMedium?.copyWith(
          color: theme.colorScheme.onSurfaceVariant,
        ),
      ),
      if (notice.lastCrawl != null)
        Text(
          '最近抓取：${DateTime.parse(notice.lastCrawl!).toLocal().toString().substring(0, 16)}',
          style: theme.textTheme.bodySmall,
        ),
      const SizedBox(height: 12),
      Wrap(
        spacing: 8,
        runSpacing: 4,
        children: [
          if (notice.contentType != null)
            Chip(label: Text(contentTypeNames[notice.contentType] ?? '未知类型')),
          for (final category in notice.categories)
            Chip(label: Text(categoryNames[category] ?? category)),
        ],
      ),
      ListenableBuilder(
        listenable: widget.services.settings,
        builder: (context, _) {
          final p = widget.services.settings.value;
          final important = p.importantIds.contains(notice.id);
          return Padding(
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                OutlinedButton.icon(
                  icon: Icon(important ? Icons.error : Icons.error_outline),
                  label: Text(important ? '已标重要' : '标记重要'),
                  onPressed: () => perform(
                    context,
                    () => widget.services.settings.toggleImportant(notice.id),
                  ),
                ),
                OutlinedButton.icon(
                  icon: Icon(
                    p.starredIds.contains(notice.id)
                        ? Icons.star
                        : Icons.star_border,
                  ),
                  label: Text(p.starredIds.contains(notice.id) ? '管理收藏' : '收藏'),
                  onPressed: () =>
                      chooseFavorite(context, widget.services, notice),
                ),
                if (notice.deadline != null)
                  OutlinedButton.icon(
                    icon: const Icon(Icons.notifications_outlined),
                    label: const Text('提醒我'),
                    onPressed: () => _remind(notice),
                  ),
                OutlinedButton.icon(
                  icon: const Icon(Icons.sell_outlined),
                  label: const Text('标签'),
                  onPressed: () => editTags(context, widget.services, notice),
                ),
              ],
            ),
          );
        },
      ),
      for (final plan in widget.services.reminders.plans.where(
        (plan) => plan.id == notice.id,
      ))
        Card.filled(
          child: ListTile(
            leading: const Icon(Icons.notifications_active_outlined),
            title: const Text('本地提醒已安排'),
            subtitle: Text(plan.when.toLocal().toString().substring(0, 16)),
            trailing: IconButton(
              tooltip: '取消提醒',
              icon: const Icon(Icons.close),
              onPressed: () => perform(context, () async {
                await widget.services.reminders.cancel(notice.id);
                if (mounted) setState(() {});
              }),
            ),
          ),
        ),
      Card.filled(
        margin: const EdgeInsets.symmetric(vertical: 12),
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(Icons.auto_awesome, color: theme.colorScheme.primary),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text('AI 信息提炼', style: theme.textTheme.titleMedium),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              _Fact(
                '截止日期',
                notice.deadline == null
                    ? '未提及'
                    : '${notice.deadline} · ${deadlineLabel(notice.deadline!)}',
                icon: Icons.event,
                color: notice.deadline == null ? null : theme.colorScheme.error,
              ),
              _Fact(
                '面向对象',
                notice.targetAudience.isEmpty ? '未提及' : notice.targetAudience,
                icon: Icons.people_outline,
              ),
              _Fact(
                '核心行动 / 地点',
                notice.coreAction.isEmpty ? '未提及' : notice.coreAction,
                icon: Icons.place_outlined,
              ),
              const Divider(height: 24),
              SelectableText(
                notice.aiSummary.isEmpty
                    ? '暂无 AI 摘要，请以通知原文为准。'
                    : notice.aiSummary,
                style: theme.textTheme.bodyLarge?.copyWith(height: 1.7),
              ),
              const SizedBox(height: 12),
              Text('AI 提炼仅供参考，请以官网原文为准。', style: theme.textTheme.bodySmall),
            ],
          ),
        ),
      ),
      const SizedBox(height: 16),
      Row(
        children: [
          Expanded(child: Text('通知原文', style: theme.textTheme.titleLarge)),
          if (notice.originUrl.isNotEmpty)
            TextButton(
              onPressed: () => perform(
                context,
                () => widget.services.actions.openUrl(
                  notice.originUrl,
                  trusted: true,
                ),
              ),
              child: const Text('查看官网'),
            ),
        ],
      ),
      const SizedBox(height: 12),
      if (_content?.limited == true)
        const Padding(
          padding: EdgeInsets.only(bottom: 12),
          child: Text('部分过深或过于复杂的正文结构已安全忽略，可前往官网查看完整内容。'),
        ),
      if (_content?.html.trim().isNotEmpty == true)
        SelectionArea(
          child: HtmlWidget(
            _content!.html,
            textStyle: theme.textTheme.bodyLarge?.copyWith(height: 1.75),
            onTapUrl: (url) async {
              await perform(
                context,
                () => widget.services.actions.openUrl(url),
              );
              return true;
            },
            onTapImage: (image) {
              if (image.sources.isNotEmpty) {
                unawaited(_preview(image.sources.first.url, image.alt));
              }
            },
            onErrorBuilder: (_, element, error) =>
                const Text('部分内容无法显示，可前往官网查看。'),
          ),
        )
      else
        const EmptyNotice(
          icon: Icons.article_outlined,
          title: '暂无原文内容',
          message: '可通过“查看官网”阅读来源页面。',
        ),
      const Divider(height: 40),
      Text('附件', style: theme.textTheme.titleLarge),
      const SizedBox(height: 8),
      if (notice.attachments.isEmpty) const Text('暂无附件'),
      for (final attachment in notice.attachments)
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: const Icon(Icons.attach_file),
          title: Text(attachment.name),
          subtitle: const Text('点击在外部应用打开'),
          onTap: () => perform(
            context,
            () => widget.services.actions.openUrl(attachment.url),
          ),
          trailing: IconButton(
            tooltip: '复制附件链接：${attachment.name}',
            icon: const Icon(Icons.content_copy),
            onPressed: () => perform(context, () async {
              await widget.services.actions.copy(attachment.url);
              if (context.mounted) showMessage(context, '附件链接已复制');
            }),
          ),
        ),
    ];
  }
}

class _Fact extends StatelessWidget {
  const _Fact(this.label, this.value, {required this.icon, this.color});
  final String label, value;
  final IconData icon;
  final Color? color;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 7),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(
          icon,
          size: 22,
          color: Theme.of(context).colorScheme.onSurfaceVariant,
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: Theme.of(context).textTheme.labelMedium),
              const SizedBox(height: 4),
              SelectableText(
                value,
                style: Theme.of(context).textTheme.bodyLarge
                    ?.copyWith(color: color),
              ),
            ],
          ),
        ),
      ],
    ),
  );
}
