# upload.py (Release sisteminde kullanılmaz)
import sys

# Bu sadece eski sistemi bozmamak için dummy bırakıldı
channel_id = sys.argv[1]
file_path = sys.argv[2]

print(f"[INFO] Skipped upload.py (Release mode) → {file_path}")
