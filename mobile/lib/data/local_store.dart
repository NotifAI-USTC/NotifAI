import 'dart:convert';

import 'package:sqflite/sqflite.dart';

/// A versioned JSON store. Database and JSON errors deliberately reach the caller.
class LocalStore {
  LocalStore.fromDatabase(this.database);
  final Database database;

  static Future<LocalStore> open({
    String? path,
    DatabaseFactory? factory,
  }) async {
    final dbFactory = factory ?? databaseFactory;
    final location =
        path ?? '${await dbFactory.getDatabasesPath()}/notifai-mobile.sqlite';
    final database = await dbFactory.openDatabase(
      location,
      options: OpenDatabaseOptions(
        version: 1,
        onCreate: (db, version) async {
          await db.execute(
            'CREATE TABLE kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)',
          );
        },
      ),
    );
    return LocalStore.fromDatabase(database);
  }

  Future<Object?> read(String key) async {
    final rows = await database.query(
      'kv',
      columns: ['value'],
      where: 'key = ?',
      whereArgs: [key],
      limit: 1,
    );
    if (rows.isEmpty) return null;
    return jsonDecode(rows.single['value'] as String);
  }

  Future<void> write(String key, Object? value) => writeAll({key: value});

  Future<void> writeAll(Map<String, Object?> values) async {
    // Encoding before BEGIN avoids partially committing an unencodable update.
    final encoded = values.map(
      (key, value) => MapEntry(key, value == null ? null : jsonEncode(value)),
    );
    await database.transaction((txn) async {
      final batch = txn.batch();
      for (final entry in encoded.entries) {
        if (entry.value == null) {
          batch.delete('kv', where: 'key = ?', whereArgs: [entry.key]);
        } else {
          batch.insert('kv', {
            'key': entry.key,
            'value': entry.value,
          }, conflictAlgorithm: ConflictAlgorithm.replace);
        }
      }
      await batch.commit(noResult: true);
    });
  }

  Future<void> remove(String key) => write(key, null);

  Future<void> removePrefix(String prefix) async {
    await database.delete(
      'kv',
      where: 'substr(key, 1, length(?)) = ?',
      whereArgs: [prefix, prefix],
    );
  }

  Future<void> close() => database.close();
}
