import 'package:flutter/material.dart';

import 'tab_item.dart';
import 'count_style.dart';

class BuildIcon extends StatelessWidget {
  final TabItem item;
  final double iconSize;
  final Color iconColor;
  final CountStyle? countStyle;

  const BuildIcon({
    super.key,
    required this.item,
    required this.iconColor,
    this.iconSize = 22,
    this.countStyle,
  });

  @override
  Widget build(BuildContext context) {
    final Widget baseIcon;
    if (item.icon is Widget) {
      baseIcon = IconTheme(
        data: IconThemeData(size: iconSize, color: iconColor),
        child: SizedBox(width: iconSize, height: iconSize, child: Center(child: item.icon as Widget)),
      );
    } else {
      baseIcon = Icon(item.icon as IconData, size: iconSize, color: iconColor);
    }

    if (item.count is Widget) {
      final double sizeBadge = countStyle?.size ?? 18;

      return Stack(
        clipBehavior: Clip.none,
        children: [
          baseIcon,
          PositionedDirectional(
            start: iconSize - sizeBadge / 2,
            top: -sizeBadge / 2,
            child: item.count!,
          ),
        ],
      );
    }

    if (item.badgeCount != null && item.badgeCount! > 0) {
      return Stack(
        clipBehavior: Clip.none,
        children: [
          baseIcon,
          Positioned(
            right: -6,
            top: -6,
            child: Container(
              padding: const EdgeInsets.all(1),
              decoration: const BoxDecoration(
                color: Colors.red,
                shape: BoxShape.circle,
              ),
              constraints: const BoxConstraints(minWidth: 15, minHeight: 15),
              child: Text(
                item.badgeCount! > 9 ? '9+' : '${item.badgeCount}',
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 10,
                  fontWeight: FontWeight.bold,
                ),
                textAlign: TextAlign.center,
              ),
            ),
          ),
        ],
      );
    }

    return baseIcon;
  }
}
