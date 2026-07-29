"""Shared, arena-independent infrastructure for the RL tournament.

Everything in this package is used by MORE than one arena (or by the server):
the base tabular agent, the shared grid / continuous engines, the world
primitives, the round registry, and the tournament driver. Round-specific
game mechanics live in ``arenas/<round>/`` instead.
"""
