# Panoptrain Backlog

## Enhancements

### Parallel route lines on map
Overlapping routes sharing the same physical track (e.g., 1/2/3 on 7th Ave, B/D/F/M on 6th Ave) should render side-by-side like the official MTA map instead of stacking on top of each other. Use MapLibre `line-offset` paint property with per-route offset values based on trunk group position.

### Improve stop/station visibility
Station dots are currently small gray circles (`circle-radius: 2`, color `#555`) that only appear at zoom 13+. Make stops clearer — consider larger markers, labels at higher zoom levels, transfer station indicators, and/or showing which routes serve each station.
