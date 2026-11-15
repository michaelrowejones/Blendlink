# SPDX-License-Identifier: GPL-3.0-or-later
"""CPU-only failure-card checks through both actual desktop task runners."""
import importlib.util
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch


root = Path(__file__).resolve().parents[1]
package = types.ModuleType("scenetoweb_task_messages_check")
package.__path__ = [str(root)]


def load(name):
    spec = importlib.util.spec_from_file_location(package.__name__ + "." + name, root / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


with patch.dict(sys.modules, {package.__name__: package, "bpy": types.ModuleType("bpy")}):
    runners = [load("previewrun"), load("syncrun")]


class TaskMessageChecks(unittest.TestCase):
    def check_both(self, lines, expected):
        for runner in runners:
            with self.subTest(runner=runner.__name__):
                runner.reset_for_tests()
                for line in lines:
                    runner._handle_line(line)
                before = list(runner._state["tail"])
                self.assertEqual(runner.last_message(), expected)
                self.assertEqual(list(runner._state["tail"]), before, "Raw diagnostic lines changed")

    def test_real_npm_offline_failure_explains_the_recovery(self):
        # npm 11 output from an actual empty-cache --offline exec outside the
        # repository. No registry access or executable package was required.
        self.check_both([
            "npm error code ENOTCACHED",
            "npm error request to https://registry.npmjs.org/scenetoweb failed: cache mode is 'only-if-cached' but no cached response is available.",
            "npm error A complete log of this run can be found in: /private/cache/_logs/debug-0.log",
        ], "The website tools needed for this action are not cached for offline use. "
           "Enable Allow Online Access in Blender Preferences → System, "
           "then retry this action. Open Log for the download details.")

    def test_network_and_registry_causes_survive_the_debug_log_footer(self):
        for cause in ["npm error network request failed: connection reset",
                      "npm error 404 'scenetoweb@0.9.0' is not in this registry."]:
            self.check_both([cause, "npm error A complete log of this run can be found in: /cache/debug.log"], cause)

    def test_legacy_npm_prefix_also_preserves_the_cause(self):
        cause = "npm ERR! network request failed: connection reset"
        self.check_both([cause, "npm ERR!", "npm ERR! A complete log of this run can be found in: /cache/debug.log"], cause)

    def test_compiler_failure_takes_precedence_over_stack_or_npm_noise(self):
        self.check_both(["Error: Scene export blocked: missing camera", "    at run (cli.js:123:4)",
                         "npm error A complete log of this run can be found in: /cache/debug.log"],
                        "Error: Scene export blocked: missing camera")

    def test_other_errors_do_not_receive_an_offline_compiler_remedy(self):
        cause = "Error: Scene export blocked: missing companion"
        self.check_both(["npm error code ENOTCACHED", cause], cause)

    def test_empty_and_plain_failures_keep_the_existing_fallback(self):
        self.check_both([], "")
        self.check_both([" ", "A plain process explanation"], "A plain process explanation")
        self.check_both(["npm error A complete log of this run can be found in: /cache/debug.log"], "")


if __name__ == "__main__":
    result = unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromTestCase(TaskMessageChecks))
    if not result.wasSuccessful():
        raise SystemExit(1)
    print("BLENDLINK_TASK_MESSAGES_PASSED")
