# Vice Bay Nights delivery outcomes

- [ ] Build a playable English-language third-person open world with four distinct districts: beachfront/neon strip, downtown and bank, port and docks, and outskirts/wetlands; include roads, beaches, boardwalk, pier, bridges, warehouses, containers, cranes, ramps and safehouses. Provide clear minimap/world-map markers, interactive props and performance-conscious instancing/culling.
- [ ] Provide smooth on-foot movement, sprint, jump/vault, crouch, swimming and vehicle entry/exit, with hit and knockback reactions.
- [ ] Implement varied driveable vehicles with suspension, braking dive, acceleration squat, body roll, speed-sensitive steering, tire grip/handbrake drift, surface differences, collision damage, smoke, fire, dents and break-off effects.
- [ ] Add animated water, varied road/ground/building materials, lane details, windows, neon and vehicle/streetlight glows, as well as fog, shadows, weather and day/night transitions with controlled bloom.
- [ ] Add moving multi-lane traffic, pedestrian walking and fleeing, wildlife, and wanted escalation with police patrols, roadblocks, tactical response and helicopter pursuit. Connect combat effects, ammunition and visible impacts to actual gameplay.
- [ ] Make missions, races, stunts, deliveries/bounties, upgrades, safehouses, cinematics and persistent progress available through real gameplay, with HUD, pause and map menus and procedural audio for vehicles, sirens, combat and radio.
- [ ] Configure the selected online leaderboard and Stripe integration. Do not invent prices or claim unverified checkout, server persistence or global leaderboard functionality.
- [ ] Offer an optional no-ads pass at €2.99 EUR per month as a recurring Stripe subscription, with clear recurring billing, cancellation and subscription status. Preserve offline play, attach purchases to a durable player identity, and disclose that the current game contains no ads for any player.
- [x] Validate a production build, live preview and meaningful gameplay transitions. Document any unavailable premium model generation or unimplemented approved scope accurately.

## Current implementation and remaining limits

- A new procedural city, keyboard/mouse controls, local progress, four checkpoint contracts, driveable vehicle types, weather presets and a casual guest leaderboard client are connected. The original project and saves were unavailable.
- The highest-quality generated 3D models and rigged animation were deferred because the selected high-quality image step was unavailable on the current plan; characters, vehicles, world, animation and audio are procedural.
- Vehicle suspension and AI are arcade approximations. Race and delivery objectives are checkpoint-based; there are no racing opponents, package inventory or bounty activity. Vaulting, full cover/pathfinding and automatic day/night cycling remain incomplete. Mobile touch controls are not wired to the active game.
- Leaderboard API health and reads have been checked, but real ranked end-to-end acceptance in a saved Preview remains unverified. Guest scores are browser-local, client-reported and unsuitable for prizes. The Stripe sandbox is unclaimed. The requested no-ads pass is €2.99 EUR/month; subscription checkout and entitlement fulfillment are not yet implemented, and the game currently shows no ads to anyone.
