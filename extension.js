//    Tasks - GNOME Shell extension - @fthx 2026

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { AppMenu } from 'resource:///org/gnome/shell/ui/appMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

const UNFOCUSED_BUTTON_OPACITY = 128; // 0...255
const BUTTON_WIDTH_RATIO = 0.1; // 0...1

class TaskButton extends PanelMenu.Button {
    static {
        GObject.registerClass(this);
    }

    constructor(window) {
        super(0.5, null, true);

        this._window = window;

        this._makeButtonBox();

        this._updateApp();
        this._updateTitle();
        this._updateState();
        this._updateWidth();

        this._connectSignals();
    }

    _connectSignals() {
        global.workspace_manager.connectObject('active-workspace-changed', () => this._updateState(), this);
        global.display.connectObject('notify::focus-window', () => this._updateState(), this);
        Main.layoutManager.connectObject('monitors-changed', () => this._updateWidth(), this);

        this._window?.connectObject(
            'notify::demands-attention', () => this._updateState(),
            'notify::gtk-application-id', () => this._updateApp(), GObject.ConnectFlags.AFTER,
            'notify::skip-taskbar', () => this._updateState(),
            'notify::title', () => this._updateTitle(),
            'notify::urgent', () => this._updateState(),
            'notify::wm-class', () => this._updateApp(), GObject.ConnectFlags.AFTER,
            'unmanaging', () => this.destroy(),
            'workspace-changed', () => this._updateState(),
            this);

        this.remove_action(this._clickGesture);
        this._clickGesture = new Clutter.ClickGesture();
        this._clickGesture.connectObject('recognize', gesture => this._onClick(gesture), this);
        this.add_action(this._clickGesture);
    }

    _disconnectSignals() {
        global.workspace_manager.disconnectObject(this);
        global.display.disconnectObject(this);
        Main.layoutManager.disconnectObject(this);

        this._window?.disconnectObject(this);
    }

    _makeButtonBox() {
        this.add_style_class_name('task-button');
        this._box = new St.BoxLayout({ style_class: 'task-box' });

        this._icon = new St.Icon();
        this._box.add_child(this._icon);

        this._title = new St.Label({ y_align: Clutter.ActorAlign.CENTER });
        this._box.add_child(this._title);

        this.add_child(this._box);

        this.setMenu(new AppMenu(this));
    }

    _toggleWindow() {
        if (Main.overview.visible || !this._windowHasFocus)
            Main.activateWindow(this._window);
        else if (this._window.can_minimize())
            this._window.minimize();
    }

    _openNewWindow() {
        if (this._app?.can_open_new_window()) {
            this._app.open_new_window(-1);
            Main.overview.hide();
        }
    }

    _onClick(gesture) {
        const button = gesture?.get_button();
        switch (button) {
            case Clutter.BUTTON_PRIMARY:
                this._toggleWindow();
                break;
            case Clutter.BUTTON_SECONDARY:
                this.menu?.toggle();
                break;
            case Clutter.BUTTON_MIDDLE:
                this._openNewWindow();
                break;
        }
    }

    _updateApp() {
        this._app = Shell.WindowTracker.get_default().get_window_app(this._window);
        if (!this._app)
            return;

        const wmClass = this._window?.wm_class;
        this._icon.fallback_gicon = this._app.icon;
        this._icon.gicon = wmClass?.startsWith('chrome') ? new Gio.ThemedIcon({ name: wmClass }) : this._app.icon;

        this.menu?.setApp(this._app);
    }

    _updateState() {
        const focusWindow = global.display.focus_window;
        this._windowHasFocus = !!focusWindow && (focusWindow === this._window || this._window.is_ancestor_of_transient(focusWindow));

        const demandsAttention = this._window.demands_attention || this._window.urgent;
        const isOnActiveWorkspace = this._window.located_on_workspace(global.workspace_manager.get_active_workspace());
        const opacity = this._windowHasFocus || demandsAttention ? 255 : UNFOCUSED_BUTTON_OPACITY;

        this._box.style_class = demandsAttention ? 'task-box task-box-demands-attention' : 'task-box';
        this._icon.opacity = this._title.opacity = opacity;
        this.visible = !this._window.skip_taskbar && (isOnActiveWorkspace || demandsAttention);
    }

    _updateTitle() {
        this._title.text = this._window?.title ?? '';
    }

    _updateWidth() {
        this._box.natural_width = Math.round(BUTTON_WIDTH_RATIO * (Main.layoutManager.primaryMonitor?.width ?? 1920));
    }

    destroy() {
        this._disconnectSignals();
        this._window = null;
        this._app = null;

        super.destroy();
    }
}

export default class TasksExtension extends Extension {
    _makeTaskbar() {
        const windows = global.display.list_all_windows().sort((a, b) => a.get_stable_sequence() - b.get_stable_sequence());
        for (const window of windows)
            this._makeTaskButton(window);

        global.display.connectObject('window-created',
            (_display, window) => this._makeTaskButton(window), this);
    }

    _makeTaskButton(window) {
        if (!window || window.skip_taskbar || window.window_type === Meta.WindowType.MODAL_DIALOG)
            return;

        const buttonId = `taskButton${window.get_id()}`;
        if (!Main.panel.statusArea[buttonId])
            Main.panel.addToStatusArea(buttonId, new TaskButton(window), 99, 'left');
    }

    enable() {
        this._initTaskbarTimeout = GLib.timeout_add_once(GLib.PRIORITY_DEFAULT, 500, () => {
            this._initTaskbarTimeout = null;

            this._makeTaskbar();
        });
    }

    disable() {
        if (this._initTaskbarTimeout)
            GLib.source_remove(this._initTaskbarTimeout);
        this._initTaskbarTimeout = null;

        global.display.disconnectObject(this);

        for (const button of Object.values(Main.panel.statusArea).filter(b => b instanceof TaskButton))
            button.destroy();
    }
}
