import 'package:flutter/material.dart';

import '../app.dart';
import '../data/models.dart';

void showMessage(BuildContext context, String message, {bool error = false}) {
  if (!context.mounted) return;
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(
      content: Text(message),
      backgroundColor: error ? Theme.of(context).colorScheme.error : null,
      showCloseIcon: true,
    ),
  );
}

Future<void> perform(
  BuildContext context,
  Future<void> Function() action,
) async {
  try {
    await action();
  } catch (error) {
    if (context.mounted) showMessage(context, '$error', error: true);
  }
}

class ErrorNotice extends StatelessWidget {
  const ErrorNotice({super.key, required this.message, this.onRetry});
  final String message;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) => Semantics(
    liveRegion: true,
    child: Card.filled(
      color: Theme.of(context).colorScheme.errorContainer,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              message,
              style: TextStyle(
                color: Theme.of(context).colorScheme.onErrorContainer,
              ),
            ),
            if (onRetry != null)
              TextButton.icon(
                onPressed: onRetry,
                icon: const Icon(Icons.refresh),
                label: const Text('重试'),
              ),
          ],
        ),
      ),
    ),
  );
}

class EmptyNotice extends StatelessWidget {
  const EmptyNotice({
    super.key,
    required this.icon,
    required this.title,
    this.message,
  });
  final IconData icon;
  final String title;
  final String? message;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 48),
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 48, color: Theme.of(context).colorScheme.primary),
        const SizedBox(height: 16),
        Text(
          title,
          style: Theme.of(context).textTheme.titleMedium,
          textAlign: TextAlign.center,
        ),
        if (message != null)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(message!, textAlign: TextAlign.center),
          ),
      ],
    ),
  );
}

class LoadingView extends StatelessWidget {
  const LoadingView({super.key});
  @override
  Widget build(BuildContext context) => const Center(
    child: Padding(
      padding: EdgeInsets.all(32),
      child: CircularProgressIndicator(semanticsLabel: '正在加载'),
    ),
  );
}

Future<String?> askText(
  BuildContext context, {
  required String title,
  String initial = '',
  String? hint,
  int maxLength = 100,
}) => showDialog<String>(
  context: context,
  builder: (_) => _TextPrompt(
    title: title,
    initial: initial,
    hint: hint,
    maxLength: maxLength,
  ),
);

class _TextPrompt extends StatefulWidget {
  const _TextPrompt({
    required this.title,
    required this.initial,
    this.hint,
    required this.maxLength,
  });
  final String title, initial;
  final String? hint;
  final int maxLength;
  @override
  State<_TextPrompt> createState() => _TextPromptState();
}

class _TextPromptState extends State<_TextPrompt> {
  late final controller = TextEditingController(text: widget.initial);
  @override
  void dispose() {
    controller.dispose();
    super.dispose();
  }

  void save() {
    if (controller.text.trim().isNotEmpty) {
      Navigator.pop(context, controller.text.trim());
    }
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text(widget.title),
    content: TextField(
      controller: controller,
      autofocus: true,
      maxLength: widget.maxLength,
      decoration: InputDecoration(labelText: widget.hint ?? widget.title),
      onSubmitted: (_) => save(),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('取消'),
      ),
      FilledButton(onPressed: save, child: const Text('保存')),
    ],
  );
}

Future<void> chooseFavorite(
  BuildContext context,
  AppServices services,
  Notice notice,
) async {
  await showModalBottomSheet<void>(
    context: context,
    showDragHandle: true,
    isScrollControlled: true,
    builder: (sheetContext) => SafeArea(
      child: ListenableBuilder(
        listenable: services.settings,
        builder: (context, _) {
          final preferences = services.settings.value;
          return ConstrainedBox(
            constraints: BoxConstraints(
              maxHeight: MediaQuery.sizeOf(context).height * .75,
            ),
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Padding(
                    padding: const EdgeInsets.all(16),
                    child: Text(
                      '选择收藏夹',
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                  ),
                  for (final folder in preferences.folders)
                    ListTile(
                      leading: Icon(
                        folder.id == preferences.starredFolderMap[notice.id]
                            ? Icons.folder_special
                            : Icons.folder_outlined,
                      ),
                      title: Text(folder.name),
                      onTap: () => perform(context, () async {
                        await services.settings.favorite(notice.id, folder.id);
                        if (sheetContext.mounted) Navigator.pop(sheetContext);
                      }),
                    ),
                  if (preferences.starredIds.contains(notice.id))
                    ListTile(
                      leading: const Icon(Icons.star_border),
                      title: const Text('取消收藏'),
                      onTap: () => perform(context, () async {
                        await services.settings.unfavorite(notice.id);
                        if (sheetContext.mounted) Navigator.pop(sheetContext);
                      }),
                    ),
                ],
              ),
            ),
          );
        },
      ),
    ),
  );
}

Future<void> editTags(
  BuildContext context,
  AppServices services,
  Notice notice,
) async {
  await showModalBottomSheet<void>(
    context: context,
    showDragHandle: true,
    isScrollControlled: true,
    builder: (sheetContext) => SafeArea(
      child: ListenableBuilder(
        listenable: services.settings,
        builder: (context, _) => Padding(
          padding: EdgeInsets.fromLTRB(
            20,
            8,
            20,
            24 + MediaQuery.viewInsetsOf(context).bottom,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('通知标签', style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 16),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final tag
                      in services.settings.value.customTags[notice.id] ??
                          <String>[])
                    InputChip(
                      label: Text(tag),
                      onDeleted: () => perform(
                        context,
                        () => services.settings.removeTag(notice.id, tag),
                      ),
                      deleteButtonTooltipMessage: '删除标签 $tag',
                    ),
                  ActionChip(
                    avatar: const Icon(Icons.add, size: 18),
                    label: const Text('添加标签'),
                    onPressed: () async {
                      final text = await askText(
                        context,
                        title: '添加标签',
                        maxLength: 50,
                      );
                      if (text != null && context.mounted) {
                        await perform(
                          context,
                          () => services.settings.addTag(notice.id, text),
                        );
                      }
                    },
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    ),
  );
}
