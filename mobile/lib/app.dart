import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'data/local_store.dart';
import 'data/notice_repository.dart';
import 'features/detail.dart';
import 'features/feed.dart';
import 'features/organizer.dart';
import 'services/notice_link.dart';
import 'services/platform_actions.dart';
import 'services/reminder_service.dart';
import 'state/user_settings.dart';

const defaultApiBase = String.fromEnvironment(
  'VITE_API_BASE_URL',
  defaultValue: 'https://api.notifai.top/api',
);
const defaultWebBase = String.fromEnvironment(
  'WEB_BASE_URL',
  defaultValue: 'https://notifai.top',
);

class AppServices {
  const AppServices({
    required this.store,
    required this.repository,
    required this.settings,
    required this.actions,
    required this.reminders,
  });
  final LocalStore store;
  final NoticeRepository repository;
  final UserSettings settings;
  final PlatformActions actions;
  final ReminderService reminders;
}

ThemeData appTheme(Brightness brightness) {
  final dark = brightness == Brightness.dark;
  final scheme =
      ColorScheme.fromSeed(
        seedColor: const Color(0xff4a6cf7),
        brightness: brightness,
      ).copyWith(
        primary: dark ? const Color(0xffb7c4ff) : const Color(0xff3857db),
        secondary: dark ? const Color(0xff5ee0b3) : const Color(0xff087f5b),
      );
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: scheme.surface,
    appBarTheme: AppBarTheme(
      backgroundColor: scheme.surface,
      foregroundColor: scheme.onSurface,
      centerTitle: false,
    ),
    inputDecorationTheme: const InputDecorationTheme(
      border: OutlineInputBorder(),
      alignLabelWithHint: true,
    ),
    visualDensity: VisualDensity.standard,
  );
}

class NotifaiApp extends StatefulWidget {
  const NotifaiApp({
    super.key,
    required this.services,
    this.handleAppLinks = true,
  });
  final AppServices services;
  final bool handleAppLinks;
  @override
  State<NotifaiApp> createState() => _NotifaiAppState();
}

class _NotifaiAppState extends State<NotifaiApp> with WidgetsBindingObserver {
  final _navigator = GlobalKey<NavigatorState>();
  final _messenger = GlobalKey<ScaffoldMessengerState>();
  StreamSubscription<Uri>? _links;
  String? _pendingNotice;
  bool _navigationQueued = false;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    widget.services.reminders.openedNotice.addListener(_notificationOpened);
    widget.services.settings.addListener(_settingsChanged);
    _notificationOpened();
    if (widget.handleAppLinks) unawaited(_listenLinks());
  }

  Future<void> _listenLinks() async {
    final appLinks = AppLinks();
    _links = appLinks.uriLinkStream.listen(
      _linkOpened,
      onError: (Object error) => _showError('通知链接无法读取：$error'),
    );
    try {
      final initial = await appLinks.getInitialLink();
      if (mounted && initial != null && _pendingNotice == null) {
        _linkOpened(initial);
      }
    } catch (e) {
      if (mounted) _showError('通知链接无法读取：$e');
    }
  }

  void _linkOpened(Uri uri) {
    final id = noticeIdFromUri(uri, webBaseUrl: defaultWebBase);
    if (id == null) {
      _showError('无法识别或不可信的通知链接');
      return;
    }
    _pendingNotice = id;
    _flushNavigation();
  }

  void _notificationOpened() {
    final id = widget.services.reminders.openedNotice.value;
    if (id != null) {
      _pendingNotice = id;
      widget.services.reminders.openedNotice.value = null;
      _flushNavigation();
    }
  }

  void _settingsChanged() {
    _flushNavigation();
  }

  void _showError(String error) =>
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          _messenger.currentState?.showSnackBar(
            SnackBar(content: Text(error), showCloseIcon: true),
          );
        }
      });
  void _flushNavigation() {
    if (_pendingNotice == null ||
        _navigationQueued ||
        !widget.services.settings.onboarded) {
      return;
    }
    _navigationQueued = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _navigationQueued = false;
      if (!mounted ||
          !widget.services.settings.onboarded ||
          _navigator.currentState == null ||
          _pendingNotice == null) {
        return;
      }
      final id = _pendingNotice!;
      _pendingNotice = null;
      _navigator.currentState!.push(
        MaterialPageRoute<void>(
          builder: (_) => DetailScreen(services: widget.services, id: id),
        ),
      );
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      unawaited(widget.services.reminders.reconcile());
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _links?.cancel();
    widget.services.reminders.openedNotice.removeListener(_notificationOpened);
    widget.services.settings.removeListener(_settingsChanged);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: widget.services.settings,
    builder: (context, _) {
      final settings = widget.services.settings;
      return MaterialApp(
        title: 'NotifAI · 科大通知',
        debugShowCheckedModeBanner: false,
        navigatorKey: _navigator,
        scaffoldMessengerKey: _messenger,
        theme: appTheme(Brightness.light),
        darkTheme: appTheme(Brightness.dark),
        themeMode: switch (settings.value.darkMode) {
          'light' => ThemeMode.light,
          'dark' => ThemeMode.dark,
          _ => ThemeMode.system,
        },
        locale: const Locale('zh', 'CN'),
        supportedLocales: const [Locale('zh', 'CN'), Locale('en')],
        localizationsDelegates: GlobalMaterialLocalizations.delegates,
        home: settings.onboarded || settings.readOnly
            ? _MainShell(services: widget.services)
            : OnboardingScreen(services: widget.services),
        builder: (context, child) => Column(
          children: [
            if (settings.error != null)
              Material(
                color: Theme.of(context).colorScheme.errorContainer,
                child: SafeArea(
                  bottom: false,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 8,
                    ),
                    child: Row(
                      children: [
                        Expanded(child: Text(settings.error!)),
                        IconButton(
                          tooltip: '关闭设置提示',
                          onPressed: settings.clearError,
                          icon: const Icon(Icons.close),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            Expanded(child: child ?? const SizedBox.shrink()),
          ],
        ),
      );
    },
  );
}

class _MainShell extends StatefulWidget {
  const _MainShell({required this.services});
  final AppServices services;
  @override
  State<_MainShell> createState() => _MainShellState();
}

class _MainShellState extends State<_MainShell> {
  int _index = 0;
  static const _destinations = [
    NavigationDestination(
      icon: Icon(Icons.home_outlined),
      selectedIcon: Icon(Icons.home),
      label: '首页',
    ),
    NavigationDestination(
      icon: Icon(Icons.calendar_month_outlined),
      selectedIcon: Icon(Icons.calendar_month),
      label: '日历',
    ),
    NavigationDestination(
      icon: Icon(Icons.star_border),
      selectedIcon: Icon(Icons.star),
      label: '收藏',
    ),
    NavigationDestination(
      icon: Icon(Icons.person_outline),
      selectedIcon: Icon(Icons.person),
      label: '我的',
    ),
  ];
  @override
  Widget build(BuildContext context) {
    final page = switch (_index) {
      0 => FeedScreen(services: widget.services),
      1 => CalendarScreen(services: widget.services),
      2 => FavoritesScreen(services: widget.services),
      _ => UserScreen(services: widget.services),
    };
    if (MediaQuery.sizeOf(context).width >= 720) {
      return Scaffold(
        body: SafeArea(
          child: Row(
            children: [
              NavigationRail(
                scrollable: true,
                selectedIndex: _index,
                onDestinationSelected: (index) =>
                    setState(() => _index = index),
                labelType: NavigationRailLabelType.all,
                destinations: [
                  for (final destination in _destinations)
                    NavigationRailDestination(
                      icon: destination.icon,
                      selectedIcon: destination.selectedIcon,
                      label: Text(destination.label),
                    ),
                ],
              ),
              const VerticalDivider(width: 1),
              Expanded(child: page),
            ],
          ),
        ),
      );
    }
    return Scaffold(
      body: page,
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (index) => setState(() => _index = index),
        destinations: _destinations,
      ),
    );
  }
}
