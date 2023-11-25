export class LoadingSpinner {

    constructor(message, container) {
        this.message = message || 'Loading...';
        this.container = container || document.body;

        this.spinnerDivContainerOuter = document.createElement('div');
        this.spinnerDivContainerOuter.className = 'outerContainer';
        this.spinnerDivContainerOuter.style.display = 'none';

        this.spinnerDivContainer = document.createElement('div');
        this.spinnerDivContainer.className = 'container';

        this.spinnerDiv = document.createElement('div');
        this.spinnerDiv.className = 'loader';

        this.messageDiv = document.createElement('div');
        this.messageDiv.className = 'message';
        this.messageDiv.innerHTML = this.message;

        this.spinnerDivContainer.appendChild(this.spinnerDiv);
        this.spinnerDivContainer.appendChild(this.messageDiv);
        this.spinnerDivContainerOuter.appendChild(this.spinnerDivContainer);
        this.container.appendChild(this.spinnerDivContainerOuter);

        const style = document.createElement('style');
        style.innerHTML = `

            .message {
                font-family: arial;
                font-size: 12pt;
                color: #ffffff;
                text-align: center;
                padding-top:15px;
                width: 180px;
            }

            .outerContainer {
                width: 100%;
                height: 100%;
            }

            .container {
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-80px, -80px);
                width: 180px;
            }

            .loader {
                width: 120px;        /* the size */
                padding: 15px;       /* the border thickness */
                background: #07e8d6; /* the color */
                z-index:99999;
            
                aspect-ratio: 1;
                border-radius: 50%;
                --_m: 
                    conic-gradient(#0000,#000),
                    linear-gradient(#000 0 0) content-box;
                -webkit-mask: var(--_m);
                    mask: var(--_m);
                -webkit-mask-composite: source-out;
                    mask-composite: subtract;
                box-sizing: border-box;
                animation: load 1s linear infinite;
                margin-left: 30px;
            }
            
            @keyframes load {
                to{transform: rotate(1turn)}
            }

        `;
        this.spinnerDivContainerOuter.appendChild(style);
    }

    show() {
        this.spinnerDivContainerOuter.style.display = 'block';
    }

    hide() {
        this.spinnerDivContainerOuter.style.display = 'none';
    }

    setContainer(container) {
        if (this.container) {
            this.container.removeChild(this.spinnerDivContainerOuter);
        }
        this.container = container;
        this.container.appendChild(this.spinnerDivContainerOuter);
        this.spinnerDivContainerOuter.style.zIndex = this.container.style.zIndex + 1;
    }

    setMessage(msg) {
        this.messageDiv.innerHTML = msg;
    }
}
