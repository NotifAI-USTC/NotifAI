import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'app.dart';
import 'data/local_store.dart';
import 'data/notice_repository.dart';
import 'services/platform_actions.dart';
import 'services/reminder_service.dart';
import 'state/user_settings.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const AppBootstrap());
}

Future<AppServices> createAppServices({
  String? databasePath,
  String apiBase = defaultApiBase,
  String webBase = defaultWebBase,
}) async {
  final store = await LocalStore.open(path: databasePath);
  try {
    final repository = NoticeRepository(store: store, baseUrl: apiBase);
    final settings = UserSettings(store);
    await settings.initialize();
    final reminders = ReminderService(store, repository, settings);
    try {
      await reminders.initialize();
    } catch (_) {
      // Reading notices remains available. The real initialization error is
      // retained by ReminderService and shown in notification settings.
    }
    return AppServices(
      store: store,
      repository: repository,
      settings: settings,
      actions: PlatformActions(webBaseUrl: webBase),
      reminders: reminders,
    );
  } catch (_) {
    await store.close();
    rethrow;
  }
}

class AppBootstrap extends StatefulWidget {
  const AppBootstrap({super.key});
  @override
  State<AppBootstrap> createState() => _AppBootstrapState();
}

class _AppBootstrapState extends State<AppBootstrap> {
  late Future<AppServices> _startup = createAppServices();
  @override
  Widget build(BuildContext context) => FutureBuilder<AppServices>(
    future: _startup,
    builder: (context, snapshot) {
      if (snapshot.hasData) return NotifaiApp(services: snapshot.data!);
      return MaterialApp(
        title: 'NotifAI',
        debugShowCheckedModeBanner: false,
        theme: appTheme(Brightness.light),
        locale: const Locale('zh', 'CN'),
        supportedLocales: const [Locale('zh', 'CN'), Locale('en')],
        localizationsDelegates: GlobalMaterialLocalizations.delegates,
        home: Scaffold(
          body: SafeArea(
            child: Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: snapshot.hasError
                    ? Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.storage_outlined, size: 48),
                          const SizedBox(height: 16),
                          const Text('无法启动本地客户端'),
                          const SizedBox(height: 8),
                          Text(
                            '${snapshot.error}',
                            textAlign: TextAlign.center,
                          ),
                          const SizedBox(height: 16),
                          FilledButton.icon(
                            onPressed: () =>
                                setState(() => _startup = createAppServices()),
                            icon: const Icon(Icons.refresh),
                            label: const Text('重试'),
                          ),
                        ],
                      )
                    : const CircularProgressIndicator(
                        semanticsLabel: '正在读取本地偏好',
                      ),
              ),
            ),
          ),
        ),
      );
    },
  );
}
