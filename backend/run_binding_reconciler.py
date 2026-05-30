"""
CLI runner for the binding reconciler.

Usage (run from `backend/` directory):

    python run_binding_reconciler.py              # dry-run: report only
    python run_binding_reconciler.py --apply      # actually update bindings
    python run_binding_reconciler.py --apply --verbose

Dry-run is safe; nothing is committed.
"""
import argparse
import sys

from database import SessionLocal
from services.binding_reconciler import (
    reconcile_bindings_from_onu_latest,
    summary_lines,
)


def main():
    ap = argparse.ArgumentParser(description="Reconcile onu_bindings from onu_latest direct MAC matches")
    ap.add_argument("--apply", action="store_true", help="Apply changes (default: dry-run)")
    ap.add_argument("--verbose", "-v", action="store_true", help="List individual changes")
    ap.add_argument("--show-conflicts", action="store_true", help="List verified-row conflicts that were skipped")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        result = reconcile_bindings_from_onu_latest(db, apply=args.apply)
    finally:
        db.close()

    print("=" * 70)
    print("Binding reconciler — " + ("APPLIED" if args.apply else "DRY RUN"))
    print("=" * 70)
    for line in summary_lines(result):
        print("  " + line)
    print()

    if args.show_conflicts:
        conflicts = [c for c in result.changes if c.action == "skip_verified_conflict"]
        if conflicts:
            print(f"VERIFIED-ROW CONFLICTS ({len(conflicts)}) — need manual review:")
            print(f"  {'binding_id':>10}  {'customer':<28}  {'source':<18}  {'from':<22}  {'to':<22}")
            for c in conflicts:
                print(f"  {c.binding_id:>10}  {c.customer_id:<28}  {c.binding_source:<18}  {str(c.from_position):<22}  {c.to_position:<22}")
            print()

    if args.verbose:
        actions = [c for c in result.changes if c.action != "skip_verified_conflict"]
        if actions:
            print(f"CHANGES ({len(actions)}):")
            print(f"  {'binding_id':>10}  {'customer':<28}  {'action':<8}  {'source':<18}  {'from':<22}  {'to':<22}  {'conf':<10}")
            shown = 0
            for c in actions:
                if shown >= 50 and not args.apply:
                    print(f"  ... ({len(actions) - shown} more, re-run with --apply to commit all)")
                    break
                print(f"  {c.binding_id:>10}  {c.customer_id:<28}  {c.action:<8}  {c.binding_source:<18}  {str(c.from_position):<22}  {c.to_position:<22}  {c.confidence:<10}")
                shown += 1

    if not args.apply and (result.position_filled or result.position_updated):
        print(f"\n(Dry run. Re-run with --apply to commit "
              f"{result.position_filled + result.position_updated} updates.)")


if __name__ == "__main__":
    sys.exit(main() or 0)
