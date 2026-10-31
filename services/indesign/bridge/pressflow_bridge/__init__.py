"""PressFlow AI InDesign bridge worker.

Pulls render jobs from the PressFlow API, runs the ExtendScript renderer in Adobe InDesign
(desktop via osascript/COM, or InDesign Server via SOAP RunScript) and uploads the results.
"""

__version__ = "0.1.0"
