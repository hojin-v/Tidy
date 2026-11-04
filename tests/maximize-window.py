#!/usr/bin/python3
"""A real GTK Wayland titlebar for the private compositor hover test."""
import gi
gi.require_version('Gtk', '4.0')
from gi.repository import Gtk

app = Gtk.Application(application_id='local.winubun.HoverTest')


def activate(application):
    window = Gtk.ApplicationWindow(application=application, title='Tidy hover test',
        default_width=900, default_height=500)
    header = Gtk.HeaderBar()
    header.set_decoration_layout(':minimize,maximize,close')
    window.set_titlebar(header)
    window.set_child(Gtk.Label(label='Tidy maximize button test'))
    window.present()


app.connect('activate', activate)
app.run(None)
