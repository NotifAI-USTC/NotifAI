import 'package:flutter/material.dart';

import '../app.dart';
import '../data/models.dart';
import '../state/user_settings.dart';
import '../ui/common.dart';
import '../ui/notice_card.dart';
import 'detail.dart';

part 'organizer/preferences.dart';
part 'organizer/collections.dart';
part 'organizer/user.dart';

class _PageBody extends StatelessWidget {
  const _PageBody({required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) => SafeArea(
    top: false,
    child: Align(
      alignment: Alignment.topCenter,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 840),
        child: child,
      ),
    ),
  );
}

class _Section extends StatelessWidget {
  const _Section(this.title, {required this.child, this.description});
  final String title;
  final String? description;
  final Widget child;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 24),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Semantics(
          header: true,
          child: Text(title, style: Theme.of(context).textTheme.titleLarge),
        ),
        if (description != null) ...[
          const SizedBox(height: 8),
          Text(description!, style: Theme.of(context).textTheme.bodyMedium),
        ],
        const SizedBox(height: 12),
        child,
      ],
    ),
  );
}

Future<bool> _confirm(
  BuildContext context,
  String title,
  String message,
) async =>
    await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: Text(message),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('确认'),
          ),
        ],
      ),
    ) ??
    false;

void _openNotice(BuildContext context, AppServices services, String id) {
  Navigator.of(context).push(
    MaterialPageRoute<void>(
      builder: (_) => DetailScreen(services: services, id: id),
    ),
  );
}

String _localTimestamp(DateTime date) =>
    '${dateOnly(date)} ${date.hour.toString().padLeft(2, '0')}:${date.minute.toString().padLeft(2, '0')}';
