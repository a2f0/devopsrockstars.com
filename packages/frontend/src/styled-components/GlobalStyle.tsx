import {createGlobalStyle} from 'styled-components';

const GlobalStyle = createGlobalStyle`
  :root {
    --hover-color: gray;
    --foreground-color: white;
  }

  html {
    pointer-events: none;
    margin-left: calc(100vw - 100%);
    margin-right: 0;
    scroll-padding-top: calc(var(--header-height, 60px) + 16px);
  }

  body {
    background-color: black;
    color: var(--foreground-color);
    margin:0;
    font-family: Open-Sans, Helvetica, Sans-Serif;
    font-size: 20px;
  }

  button, input, select, form {
    pointer-events: auto;
  }

  a {
    color: var(--foreground-color);
    pointer-events: auto;
  }

  a:hover {
    color: var(--hover-color);
  }

  h1 {
    margin-top: 35px;
    margin-right: 0px;
    margin-left: 0px;
    margin-bottom: 0px;
    font-size: 22px;
  }

  p {
    margin: 0;
  }
`;

export default GlobalStyle;
