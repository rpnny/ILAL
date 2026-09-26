// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Explicitly testnet-only asset used by the issuer pilot.
contract PilotAsset is Ownable {
    string public name;
    string public symbol;
    uint8 public immutable decimals;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory assetName, string memory assetSymbol, uint8 assetDecimals, address controller)
        Ownable(controller)
    {
        require(controller != address(0) && assetDecimals == 6, "PILOT_ASSET_CONFIG");
        name = assetName;
        symbol = assetSymbol;
        decimals = assetDecimals;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "PILOT_ASSET_RECIPIENT");
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        return _transfer(msg.sender, to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 permitted = allowance[from][msg.sender];
        if (permitted != type(uint256).max) {
            require(permitted >= amount, "PILOT_ASSET_ALLOWANCE");
            allowance[from][msg.sender] = permitted - amount;
        }
        return _transfer(from, to, amount);
    }

    function _transfer(address from, address to, uint256 amount) private returns (bool) {
        require(to != address(0) && balanceOf[from] >= amount, "PILOT_ASSET_TRANSFER");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}
