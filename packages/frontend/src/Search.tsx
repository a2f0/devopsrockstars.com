import React, {type FormEvent, useState} from 'react';
import styled from 'styled-components';

const SearchForm = styled.form`
  width: 100%;
  pointer-events: auto;
`;

const SearchLogo = styled.div`
  width: min(375px, calc(100% - 24px));
  aspect-ratio: 167.38037 / 33.959961;
  margin: 50px auto 25px;

  img {
    display: block;
    width: 100%;
    height: 100%;
  }
`;

const SearchField = styled.input`
  display: block;
  width: min(250px, calc(100% - 24px));
  box-sizing: border-box;
  border: 1px solid #404040;
  border-radius: 0;
  margin: 0 auto;
  background-color: #101010;
  color: white;
  appearance: none;
  min-height: 44px;
  padding: 10px 11px;
  font: inherit;
  font-size: 16px;

  &:focus,
  &:active {
    border-color: #666;
    outline: none;
  }
`;

const HiddenSubmit = styled.button`
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
`;

const SearchStatus = styled.p`
  margin-top: 22px;
  color: #aaa;
  font-size: 14px;
  text-align: center;
`;

const Search = React.memo(() => {
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
  };

  return (
    <SearchForm autoComplete="off" onSubmit={handleSubmit}>
      <SearchLogo>
        <img
          src="/static/image/devopsrockstars-solr.svg"
          alt="DevOpsRockstars"
        />
      </SearchLogo>
      <SearchField aria-label="Search" name="query" type="text" />
      <HiddenSubmit type="submit">Search</HiddenSubmit>
      {submitted && (
        <SearchStatus role="status">
          Search results are not connected yet. Stay tuned.
        </SearchStatus>
      )}
    </SearchForm>
  );
});

export default Search;
