#!/bin/sh
# A second virtual monitor lets the Shell integration test exercise transfers.
exec "$@" --virtual-monitor=1600x900
