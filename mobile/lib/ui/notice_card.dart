import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../app.dart';
import '../data/models.dart';
import '../features/detail.dart';
import 'common.dart';

class NoticeCard extends StatelessWidget {
  const NoticeCard({
    super.key,
    required this.notice,
    required this.services,
    this.onOpen,
    this.showActions = true,
  });
  final Notice notice;
  final AppServices services;
  final VoidCallback? onOpen;
  final bool showActions;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: services.settings,
    builder: (context, _) {
      final preferences = services.settings.value;
      final important = preferences.importantIds.contains(notice.id);
      final starred = preferences.starredIds.contains(notice.id);
      final read = preferences.readIds.contains(notice.id);
      final pinned = preferences.pinnedIds.contains(notice.id);
      final colors = Theme.of(context).colorScheme;
      return Card.outlined(
        clipBehavior: Clip.antiAlias,
        margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        color: important
            ? colors.errorContainer.withValues(alpha: .18)
            : colors.surface,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            InkWell(
              onTap:
                  onOpen ??
                  () => Navigator.push(
                    context,
                    MaterialPageRoute<void>(
                      builder: (_) =>
                          DetailScreen(services: services, id: notice.id),
                    ),
                  ),
              child: Padding(
                padding: EdgeInsets.fromLTRB(16, 16, 16, showActions ? 8 : 16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        if (pinned)
                          Padding(
                            padding: const EdgeInsets.only(right: 6),
                            child: Icon(
                              Icons.push_pin,
                              size: 16,
                              color: colors.primary,
                              semanticLabel: '已置顶',
                            ),
                          ),
                        Expanded(
                          child: Text(
                            '${normalizeSource(notice.source)} · ${publishDateLabel(notice.publishDate)}',
                            style: Theme.of(context).textTheme.labelMedium,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        if (read)
                          const Padding(
                            padding: EdgeInsets.only(left: 8),
                            child: Text('已读'),
                          ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    Text(
                      notice.title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.titleMedium
                          ?.copyWith(fontWeight: FontWeight.w700),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      notice.aiSummary.isEmpty
                          ? '暂无 AI 摘要，点击阅读原文'
                          : notice.aiSummary,
                      maxLines: 3,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        height: 1.55,
                        color: colors.onSurfaceVariant,
                      ),
                    ),
                    const SizedBox(height: 12),
                    Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      children: [
                        if (notice.contentType != null)
                          _Badge(
                            text:
                                contentTypeNames[notice.contentType] ?? '未知类型',
                          ),
                        for (final category in notice.categories)
                          _Badge(text: categoryNames[category] ?? category),
                        if (notice.deadline != null)
                          _Badge(
                            text: deadlineLabel(notice.deadline!),
                            urgent:
                                remainingDays(notice.deadline!) >= 0 &&
                                remainingDays(notice.deadline!) <= 3,
                          ),
                        for (final tag
                            in preferences.customTags[notice.id] ?? <String>[])
                          _Badge(text: '#$tag'),
                      ],
                    ),
                  ],
                ),
              ),
            ),
            if (showActions)
              Padding(
                padding: const EdgeInsets.fromLTRB(8, 0, 8, 4),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    IconButton(
                      tooltip: important ? '取消重要标记' : '标记为重要',
                      isSelected: important,
                      selectedIcon: Icon(Icons.error, color: colors.error),
                      icon: const Icon(Icons.error_outline),
                      onPressed: () => perform(context, () async {
                        await services.settings.toggleImportant(notice.id);
                        await HapticFeedback.selectionClick();
                      }),
                    ),
                    IconButton(
                      tooltip: starred ? '管理收藏' : '收藏通知',
                      isSelected: starred,
                      selectedIcon: Icon(Icons.star, color: colors.primary),
                      icon: const Icon(Icons.star_border),
                      onPressed: () =>
                          chooseFavorite(context, services, notice),
                    ),
                    PopupMenuButton<String>(
                      tooltip: '更多通知操作',
                      onSelected: (action) => perform(context, () async {
                        switch (action) {
                          case 'read':
                            await services.settings.markRead(notice.id);
                          case 'pin':
                            await services.settings.togglePin(notice.id);
                          case 'tags':
                            if (context.mounted) {
                              await editTags(context, services, notice);
                            }
                          case 'share':
                            if (context.mounted) {
                              await services.actions.showShareOptions(
                                context,
                                notice,
                              );
                            }
                        }
                      }),
                      itemBuilder: (_) => [
                        if (!read)
                          const PopupMenuItem(
                            value: 'read',
                            child: Text('标记已读'),
                          ),
                        PopupMenuItem(
                          value: 'pin',
                          child: Text(pinned ? '取消置顶' : '置顶通知'),
                        ),
                        const PopupMenuItem(value: 'tags', child: Text('管理标签')),
                        const PopupMenuItem(
                          value: 'share',
                          child: Text('分享通知'),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
          ],
        ),
      );
    },
  );
}

class _Badge extends StatelessWidget {
  const _Badge({required this.text, this.urgent = false});
  final String text;
  final bool urgent;
  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: urgent ? colors.errorContainer : colors.secondaryContainer,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 4),
        child: Text(
          text,
          style: Theme.of(context).textTheme.labelSmall?.copyWith(
            color: urgent
                ? colors.onErrorContainer
                : colors.onSecondaryContainer,
          ),
        ),
      ),
    );
  }
}
