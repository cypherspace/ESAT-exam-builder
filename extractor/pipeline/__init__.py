"""ESAT extractor pipeline modules.

- markers.py        Detect numbered question stems in MCQ layouts.
- mcq_clipper.py    Tight bounding-box clipping for MCQ blocks (A-E options).
- ms_parser.py      Parse mark scheme PDF for answer-key tables.
- storage.py        Local FS / GCS write abstraction.
- models.py         Shared pydantic types.
"""
