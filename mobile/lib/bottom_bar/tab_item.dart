import 'package:flutter/material.dart';

class TabItem<T> {
  final T icon;
  final String? title;
  final Widget? count;
  final String? key;
  final int? badgeCount;

  const TabItem({
    required this.icon,
    this.title,
    this.count,
    this.key,
    this.badgeCount,
  }) : assert(
          icon is IconData || icon is Widget,
          'TabItem only support IconData and Widget',
        );
}
