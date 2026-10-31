import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter/semantics.dart';

import '../app.dart';
import '../data/models.dart';
import 'common.dart';
import 'notice_card.dart';

class HomeNoticeCard extends StatefulWidget {
  const HomeNoticeCard({
    super.key,
    required this.notice,
    required this.services,
    this.onOpen,
  });
  final Notice notice;
  final AppServices services;
  final VoidCallback? onOpen;

  @override
  State<HomeNoticeCard> createState() => _HomeNoticeCardState();
}

class _HomeNoticeCardState extends State<HomeNoticeCard> {
  bool _menuOpen = false;
  Offset? _pressPosition;

  Future<bool> _swipe(DismissDirection direction) async {
    await perform(context, () async {
      // Physical left/right, independent of locale's reading direction.
      final left = Directionality.of(context) == TextDirection.ltr
          ? direction == DismissDirection.endToStart
          : direction == DismissDirection.startToEnd;
      if (left) {
        await widget.services.settings.toggleRead(widget.notice.id);
      } else {
        await widget.services.settings.togglePin(widget.notice.id);
      }
      await HapticFeedback.selectionClick();
    });
    // A swipe changes a local flag. It must never delete/dismiss the notice.
    return false;
  }

  Future<void> _menu() async {
    if (_menuOpen || !mounted) return;
    _menuOpen = true;
    final overlay =
        Overlay.of(context).context.findRenderObject()! as RenderBox;
    final box = context.findRenderObject()! as RenderBox;
    final global =
        _pressPosition ??
        box.localToGlobal(Offset(box.size.width / 2, box.size.height / 2));
    final point = overlay.globalToLocal(global);
    final starred = widget.services.settings.value.starredIds.contains(
      widget.notice.id,
    );
    try {
      final action = await showMenu<String>(
        context: context,
        position: RelativeRect.fromRect(
          Rect.fromLTWH(point.dx, point.dy, 1, 1),
          Offset.zero & overlay.size,
        ),
        items: [
          PopupMenuItem(
            value: 'favorite',
            child: Text(starred ? '管理收藏' : '收藏通知'),
          ),
          const PopupMenuItem(value: 'share', child: Text('分享通知')),
          const PopupMenuItem(value: 'tags', child: Text('管理标签')),
        ],
      );
      if (action != null && mounted) await _action(action);
    } finally {
      _menuOpen = false;
      _pressPosition = null;
    }
  }

  Future<void> _action(String action) => perform(context, () async {
    switch (action) {
      case 'read':
        await widget.services.settings.toggleRead(widget.notice.id);
      case 'pin':
        await widget.services.settings.togglePin(widget.notice.id);
      case 'favorite':
        await chooseFavorite(context, widget.services, widget.notice);
      case 'share':
        await widget.services.actions.showShareOptions(context, widget.notice);
      case 'tags':
        await editTags(context, widget.services, widget.notice);
    }
  });

  Widget _background(
    BuildContext context, {
    required bool left,
    required bool active,
  }) {
    final colors = Theme.of(context).colorScheme;
    final label = left
        ? (active ? '标记未读' : '标记已读')
        : (active ? '取消置顶' : '置顶通知');
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: left ? colors.secondaryContainer : colors.primaryContainer,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Align(
          alignment: left ? Alignment.centerRight : Alignment.centerLeft,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  left
                      ? (active
                            ? Icons.mark_email_unread_outlined
                            : Icons.mark_email_read_outlined)
                      : Icons.push_pin_outlined,
                ),
                const SizedBox(height: 8),
                Text(label),
              ],
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: widget.services.settings,
    builder: (context, _) {
      final preferences = widget.services.settings.value;
      final read = preferences.readIds.contains(widget.notice.id);
      final pinned = preferences.pinnedIds.contains(widget.notice.id);
      final rtl = Directionality.of(context) == TextDirection.rtl;
      return Semantics(
        container: true,
        hint: '左滑切换已读，右滑切换置顶，长按打开菜单。键盘 Alt+R 切换已读，Alt+P 切换置顶，Shift+F10 打开菜单。',
        onLongPress: _menu,
        customSemanticsActions: {
          CustomSemanticsAction(label: read ? '标记未读' : '标记已读'): () =>
              _action('read'),
          CustomSemanticsAction(label: pinned ? '取消置顶' : '置顶通知'): () =>
              _action('pin'),
          const CustomSemanticsAction(label: '管理收藏'): () => _action('favorite'),
          const CustomSemanticsAction(label: '分享通知'): () => _action('share'),
          const CustomSemanticsAction(label: '管理标签'): () => _action('tags'),
        },
        child: CallbackShortcuts(
          bindings: {
            const SingleActivator(LogicalKeyboardKey.f10, shift: true): _menu,
            const SingleActivator(LogicalKeyboardKey.contextMenu): _menu,
            const SingleActivator(LogicalKeyboardKey.keyR, alt: true): () => _action('read'),
            const SingleActivator(LogicalKeyboardKey.keyP, alt: true): () => _action('pin'),
          },
          child: Focus(
            child: GestureDetector(
              onLongPressStart: (details) {
                _pressPosition = details.globalPosition;
                _menu();
              },
              onSecondaryTapDown: (details) {
                _pressPosition = details.globalPosition;
                _menu();
              },
              child: Dismissible(
                key: ValueKey(widget.notice.id),
                direction: widget.services.settings.readOnly
                    ? DismissDirection.none
                    : DismissDirection.horizontal,
                dismissThresholds: const {
                  DismissDirection.startToEnd: .3,
                  DismissDirection.endToStart: .3,
                },
                confirmDismiss: _swipe,
                background: _background(
                  context,
                  left: rtl,
                  active: rtl ? read : pinned,
                ),
                secondaryBackground: _background(
                  context,
                  left: !rtl,
                  active: rtl ? pinned : read,
                ),
                child: NoticeCard(
                  notice: widget.notice,
                  services: widget.services,
                  onOpen: widget.onOpen,
                  showActions: false,
                ),
              ),
            ),
          ),
        ),
      );
    },
  );
}
