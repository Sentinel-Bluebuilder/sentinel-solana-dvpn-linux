#!/usr/bin/env bash
# Sign gcloud in with a personal Google account (opens the browser).
# gcloud needs its bundled Python on this laptop (no system Python).
export CLOUDSDK_PYTHON="/c/Program Files (x86)/Google/Cloud SDK/google-cloud-sdk/platform/bundledpython/python.exe"
gcloud auth login
