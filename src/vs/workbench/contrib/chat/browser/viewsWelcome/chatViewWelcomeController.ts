/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { asCSSUrl } from '../../../../../base/browser/cssValue.js';
import * as dom from '../../../../../base/browser/dom.js';
import { createCSSRule } from '../../../../../base/browser/domStylesheets.js';
import { renderIcon } from '../../../../../base/browser/ui/iconLabel/iconLabels.js';
import { Event } from '../../../../../base/common/event.js';
import { StringSHA1 } from '../../../../../base/common/hash.js';
import { IMarkdownString } from '../../../../../base/common/htmlContent.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { IObservable, ISettableObservable, observableValue } from '../../../../../base/common/observable.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { URI } from '../../../../../base/common/uri.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { ChatAgentLocation } from '../../common/constants.js';
import { chatViewsWelcomeRegistry, IChatViewsWelcomeDescriptor } from './chatViewsWelcome.js';

const $ = dom.$;

export interface IViewWelcomeDelegate {
	readonly onDidChangeViewWelcomeState: Event<void>;
	shouldShowWelcome(): boolean;
}

export class ChatViewWelcomeController extends Disposable {
	private element: HTMLElement | undefined;

	private enabled = false;
	private readonly enabledDisposables = this._register(new DisposableStore());
	private readonly renderDisposables = this._register(new DisposableStore());

	private readonly _isShowingWelcome: ISettableObservable<boolean> = observableValue(this, false);
	public get isShowingWelcome(): IObservable<boolean> {
		return this._isShowingWelcome;
	}

	constructor(
		private readonly container: HTMLElement,
		private readonly delegate: IViewWelcomeDelegate,
		private readonly location: ChatAgentLocation,
		@IContextKeyService private contextKeyService: IContextKeyService,
		@IInstantiationService private instantiationService: IInstantiationService,
	) {
		super();

		this.element = dom.append(this.container, dom.$('.chat-view-welcome'));
		this._register(Event.runAndSubscribe(
			delegate.onDidChangeViewWelcomeState,
			() => this.update()));
		this._register(chatViewsWelcomeRegistry.onDidChange(() => this.update(true)));
	}

	private update(force?: boolean): void {
		const enabled = this.delegate.shouldShowWelcome();
		if (this.enabled === enabled && !force) {
			return;
		}

		this.enabled = enabled;
		this.enabledDisposables.clear();

		if (!enabled) {
			this.container.classList.toggle('chat-view-welcome-visible', false);
			this.renderDisposables.clear();
			this._isShowingWelcome.set(false, undefined);
			return;
		}

		const descriptors = chatViewsWelcomeRegistry.get();
		if (descriptors.length) {
			this.render(descriptors);

			const descriptorKeys: Set<string> = new Set(descriptors.flatMap(d => d.when.keys()));
			this.enabledDisposables.add(this.contextKeyService.onDidChangeContext(e => {
				if (e.affectsSome(descriptorKeys)) {
					this.render(descriptors);
				}
			}));
		}
	}

	private render(descriptors: ReadonlyArray<IChatViewsWelcomeDescriptor>): void {
		this.renderDisposables.clear();
		dom.clearNode(this.element!);

		const matchingDescriptors = descriptors.filter(descriptor => this.contextKeyService.contextMatchesRules(descriptor.when));
		const enabledDescriptor = matchingDescriptors.at(0);
		if (enabledDescriptor) {
			const content: IChatViewWelcomeContent = {
				icon: enabledDescriptor.icon,
				title: enabledDescriptor.title,
				message: enabledDescriptor.content
			};
			const welcomeView = this.renderDisposables.add(this.instantiationService.createInstance(ChatViewWelcomePart, content, { firstLinkToButton: true, location: this.location }));
			this.element!.appendChild(welcomeView.element);
			this.container.classList.toggle('chat-view-welcome-visible', true);
			this._isShowingWelcome.set(true, undefined);
		} else {
			this.container.classList.toggle('chat-view-welcome-visible', false);
			this._isShowingWelcome.set(false, undefined);
		}
	}
}

export interface IChatViewWelcomeContent {
	readonly icon?: ThemeIcon | URI;
	readonly title: string;
	readonly message?: IMarkdownString;
	readonly additionalMessage?: string | IMarkdownString;
	tips?: IMarkdownString;
	readonly inputPart?: HTMLElement;
	readonly suggestedPrompts?: readonly IChatSuggestedPrompts[];
	readonly useLargeIcon?: boolean;
}

export interface IChatSuggestedPrompts {
	readonly icon?: ThemeIcon;
	readonly label: string;
	readonly description?: string;
	readonly prompt: string;
	readonly uri?: URI;
}

export interface IChatViewWelcomeRenderOptions {
	readonly firstLinkToButton?: boolean;
	readonly location: ChatAgentLocation;
	readonly isWidgetAgentWelcomeViewContent?: boolean;
}

export class ChatViewWelcomePart extends Disposable {
	public readonly element: HTMLElement;

	constructor(
		public readonly content: IChatViewWelcomeContent,
		_options: IChatViewWelcomeRenderOptions | undefined,
		@ILogService private logService: ILogService,
	) {
		super();

		this.element = dom.$('.chat-welcome-view');

		try {

			// Icon
			const icon = dom.append(this.element, $('.chat-welcome-view-icon'));
			if (content.useLargeIcon) {
				icon.classList.add('large-icon');
			}
			if (content.icon) {
				if (ThemeIcon.isThemeIcon(content.icon)) {
					const iconElement = renderIcon(content.icon);
					icon.appendChild(iconElement);
				} else if (URI.isUri(content.icon)) {
					const cssUrl = asCSSUrl(content.icon);
					const hash = new StringSHA1();
					hash.update(cssUrl);
					const iconId = `chat-welcome-icon-${hash.digest()}`;
					const iconClass = `.chat-welcome-view-icon.${iconId}`;

					createCSSRule(iconClass, `
					mask: ${cssUrl} no-repeat 50% 50%;
					-webkit-mask: ${cssUrl} no-repeat 50% 50%;
					background-color: var(--vscode-icon-foreground);
				`);
					icon.classList.add(iconId, 'custom-icon');
				}
			}

		} catch (err) {
			this.logService.error('Failed to render chat view welcome content', err);
		}
	}

	public needsRerender(content: IChatViewWelcomeContent): boolean {
		// Heuristic based on content that changes between states
		return !!(
			this.element.isConnected && (
				this.content.title !== content.title ||
				this.content.icon !== content.icon)
		);
	}
}
