import importlib.util
import io
import pathlib
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("safe_extract", pathlib.Path(__file__).with_name("safe-extract.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class ArchiveSafety(unittest.TestCase):
    def test_reject_unsafe_members_before_extracting(self):
        for name, kind in [("../outside", tarfile.REGTYPE), ("/absolute", tarfile.REGTYPE), ("link", tarfile.SYMTYPE), ("hardlink", tarfile.LNKTYPE), (".env", tarfile.REGTYPE), ("dir/.env.production", tarfile.REGTYPE)]:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as root:
                archive = pathlib.Path(root) / "bad.tar.gz"
                output = pathlib.Path(root) / "output"
                output.mkdir()
                with tarfile.open(archive, "w:gz") as bundle:
                    entry = tarfile.TarInfo(name)
                    entry.type = kind
                    entry.linkname = "/etc/passwd" if kind in (tarfile.SYMTYPE, tarfile.LNKTYPE) else ""
                    bundle.addfile(entry, io.BytesIO(b""))
                with self.assertRaises(ValueError):
                    module.extract(archive, output)
                self.assertEqual(list(output.iterdir()), [])

if __name__ == "__main__":
    unittest.main()
