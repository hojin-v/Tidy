/* A private-test GTK setting, equivalent to the explicit controls on the GTK
 * fixture. No browser code, accessibility tree or hit tests are replaced. */
extern void *gtk_settings_get_default(void);
extern void g_object_set(void *object, const char *property, ...);

void gtk_module_init(int *argc, char ***argv)
{
    (void)argc;
    (void)argv;
    g_object_set(gtk_settings_get_default(), "gtk-decoration-layout",
                 ":minimize,maximize,close", (void *)0);
}
