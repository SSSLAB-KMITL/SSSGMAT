"""Absolute-path entry point: no parent chdir or pre-exec callback is needed."""

from eo_engine.worker import main

if __name__ == "__main__":
    main()
