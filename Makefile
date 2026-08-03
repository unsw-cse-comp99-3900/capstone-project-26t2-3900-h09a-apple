.PHONY: demo-seed demo-smoke

demo-seed:
	cd apps/api && python -m seeds.demo_seed

demo-smoke:
	cd apps/api && pytest tests/test_demo_smoke.py